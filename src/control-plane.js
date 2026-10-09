import http from 'node:http';
import { randomBytes } from 'node:crypto';
import { URL } from 'node:url';
import { createMCPGateway } from './mcp-gateway.js';
import { analyzeBehavior, analyzeBlastRadius } from './behavior.js';
import { generateSecurityReport, renderSecurityReportHTML } from './security-report.js';
import { createPersistentAgentStore } from './persistent-store.js';
import { authorize } from './identity.js';
import { createPolicyRegistry } from './policy-registry.js';
import { TenantRegistry, WebhookRegistry } from './multi-tenant.js';
import { createAuthMiddleware } from './auth.js';
import { createPolicyBundleRegistry } from './policy-bundles.js';
import { SlidingWindowLimiter } from './telemetry.js';
import { createSaaSControl } from './saas.js';
import { runGatewayAttackLab, summarizeAttackResults } from './attack-lab.js';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';

const require = createRequire(import.meta.url);
const PACKAGE_VERSION = require('../package.json').version;

// Reads and parses a POST body with a hard size cap. Earlier versions bailed
// out of the read loop as soon as the cap was exceeded without consuming the
// rest of the incoming request — on a keep-alive connection, those unread
// bytes are still in flight from the client and get misinterpreted as the
// start of the next request, which is what caused an unrelated follow-up
// request on the same socket to hang until timeout instead of failing fast.
// Fix: once oversized, keep draining every chunk (so the socket/HTTP parser
// ends this request cleanly) but stop buffering it into memory, then raise a
// typed error with the right status for the caller to respond with.
async function readJsonBody(req, maxBodySize) {
  let raw = '';
  let bytes = 0;
  let oversized = false;
  for await (const chunk of req) {
    bytes += chunk.length;
    if (bytes > maxBodySize) { oversized = true; continue; }
    raw += chunk;
  }
  if (oversized) {
    const error = new Error('Payload too large');
    error.status = 413;
    throw error;
  }
  try {
    return raw ? JSON.parse(raw) : {};
  } catch {
    const error = new Error('Invalid JSON');
    error.status = 400;
    throw error;
  }
}

export function createControlPlane(options = {}) {
  const gateway = options.gateway || createMCPGateway(options);
  const staticHtml = options.html;
  const agentStore = options.agentStore || (options.persistence ? createPersistentAgentStore({ filePath: options.agentPersistence || `${options.persistence}/agents.json`, recoverFromCorruption: options.recoverFromCorruption, onCorruption: options.onPersistenceCorruption }) : null);
  const tenantRegistry = options.tenantRegistry || new TenantRegistry({ filePath: `${options.persistence || '.agentgate'}/tenants.json`, keyPath: `${options.persistence || '.agentgate'}/api-keys.json` });
  const webhookRegistry = options.webhookRegistry || new WebhookRegistry({ filePath: `${options.persistence || '.agentgate'}/webhooks.json`, deliveryPath: `${options.persistence || '.agentgate'}/webhook-deliveries.json` });
  const authRequired = options.authRequired !== false;
  const localDevSession = options.localDevSession === true;
  const localSessionAdmin = options.localSessionAdmin === true;
  const localSessionToken = localDevSession ? randomBytes(32).toString('hex') : null;
  const localSessionCookie = 'agentgate_local_session';
  const hasLocalSession = (req) => localDevSession && String(req.headers.cookie || '').split(';').map(x => x.trim()).some(x => x === `${localSessionCookie}=${localSessionToken}`);
  const bootstrapToken = options.bootstrapToken || process.env.AGENTGATE_BOOTSTRAP_TOKEN || null;
  const authenticate = createAuthMiddleware({ registry: tenantRegistry, publicPaths: options.publicPaths || ['/api/health', '/api/ready', '/api/metrics'] });
  const saas = options.saas || createSaaSControl({ persistence: options.persistence || '.agentgate', billing: options.billing });
  const limiter = options.rateLimiter || new SlidingWindowLimiter({ limit: options.rateLimit || 120, windowMs: options.rateWindowMs || 60000 });
  const tenantLimiter = options.tenantRateLimiter || new SlidingWindowLimiter({ limit: options.tenantRateLimit || options.rateLimit || 120, windowMs: options.rateWindowMs || 60000 });
  const startedAt = Date.now();
  // Idempotency: a client that retries POST /api/approvals/approve|deny
  // (timeout, connection reset, at-least-once delivery) must not trigger a
  // second side effect. Scoped by tenant + path + the client-supplied
  // Idempotency-Key so a retry with the same key gets back the exact same
  // response instead of re-executing (or hitting "already approved").
  const idempotencyTtlMs = Number(options.idempotencyTtlMs || 24 * 60 * 60 * 1000);
  const idempotencyCache = new Map(); // scopedKey -> { status, result, expiresAt }
  const IDEMPOTENT_PATHS = new Set(['/api/approvals/approve', '/api/approvals/deny']);
  function idempotencyGet(key) {
    if (!key) return null;
    const entry = idempotencyCache.get(key);
    if (!entry) return null;
    if (entry.expiresAt < Date.now()) { idempotencyCache.delete(key); return null; }
    return entry;
  }
  function idempotencyPut(key, status, result) {
    if (!key) return;
    idempotencyCache.set(key, { status, result, expiresAt: Date.now() + idempotencyTtlMs });
  }
  const policyRegistry = options.policyRegistry || createPolicyRegistry({ filePath: options.policyPersistence || `${options.persistence || '.agentgate'}/policies.json` });
  const bundleRegistry = options.policyBundleRegistry || createPolicyBundleRegistry({ filePath: options.policyBundlePersistence || `${options.persistence || '.agentgate'}/policy-bundles.json` });
  const agents = agentStore || { items: [], add(a){ this.items.unshift(a); return a; }, list(filter){ const all=[...this.items]; return typeof filter==='function' ? all.filter(filter) : all; }, get(id){ return this.items.find(a=>a.id===id || a.name===id) || null; }, save(){} };
  function registerAgent(input = {}, tenantId = null) {
    const name = String(input.name || input.agent || '').trim();
    if (!name) return { error: 'Agent name is required' };
    const ownerTenant = input.tenantId || tenantId || null;
    const existing = agents.list(a => a.name === name && (ownerTenant == null ? !a.tenantId : a.tenantId === ownerTenant))[0];
    if (existing) { existing.lastSeenAt = new Date().toISOString(); agents.save?.(); return existing; }
    return agents.add({ tenantId: ownerTenant, id: `agent_${name.toLowerCase().replace(/[^a-z0-9]+/g, '_')}`, name, environment: input.environment || 'production', createdAt: new Date().toISOString(), lastSeenAt: new Date().toISOString() });
  }

  function syncPolicy(name, tenantId = null) {
    if (!policyRegistry || !name) return null;
    const active = policyRegistry.active(name, tenantId);
    if (active && !tenantId) Object.assign(gateway.policies, active.policy);
    return active;
  }

  const effectivePolicies = (tenantId = null) => {
    if (!tenantId) return { ...(gateway.policies || {}) };
    const merged = { ...(gateway.policies || {}) };
    for (const item of policyRegistry?.activeAll?.(tenantId) || []) Object.assign(merged, item.policy || {});
    for (const item of bundleRegistry?.activeAll?.(tenantId) || []) Object.assign(merged, item.policies || {});
    return merged;
  };
  gateway.setPolicyResolver?.((request = {}) => effectivePolicies(request.tenantId || null));

  async function api(path, method = 'GET', body = {}, query = {}, authContext = {}) {
    const tenantId = authContext.tenantId || null;
    const scopedTenant = (candidate) => { if (!tenantId) return candidate || null; if (candidate && candidate !== tenantId) throw Object.assign(new Error('Tenant mismatch'), { status: 403 }); return tenantId; };
    const scopedRuns = () => gateway.runs(tenantId);
    const scopedApprovals = (status) => gateway.approvals(status, tenantId);
    if (path === '/api/health') return { ok: true, mode: gateway.mode, version: gateway?.serverInfo?.version || PACKAGE_VERSION };
    if (path === '/api/ready') {
      const persistence = gateway.persistenceHealth?.() || { persistent: false, degraded: false, corruptions: [] };
      const ready = !persistence.degraded;
      return { ok: ready, ready, mode: gateway.mode, uptimeSeconds: Math.floor((Date.now() - startedAt) / 1000), persistence };
    }
    if (path === '/api/kill-switch' && method === 'GET') return gateway.killStatus?.() || {killed:false};
    if (path === '/api/kill-switch' && method === 'POST') { if (body.enabled === false) return gateway.unkill?.(); return gateway.kill?.(body.reason); }
    if (path === '/api/metrics') return gateway.telemetry?.snapshot?.() || { uptimeSeconds: Math.floor((Date.now() - startedAt) / 1000), counters: {}, latency: {} };
    if (path === '/api/observability' && method === 'GET') return gateway.observability?.analyze?.(scopedRuns()) || {};
    if (path === '/api/trace' && method === 'GET') { const run = gateway.replay(query.runId || body.runId, tenantId); return run ? gateway.observability?.trace?.(run) || {} : { error: 'Run not found' }; }
    if (path === '/api/efficiency' && method === 'GET') return gateway.observability?.efficiency?.(scopedRuns(), query) || {};
    if (path === '/api/behavior/correlation' && method === 'GET') return gateway.observability?.correlation?.(scopedRuns()) || {};
    if (path === '/api/cost/analytics' && method === 'GET') return gateway.observability?.costAnalytics?.(scopedRuns(), query) || {};
    if (path === '/api/cost/forecast' && method === 'GET') return gateway.observability?.forecast?.(scopedRuns(), { ...query, monthlyBudget: Number(query.monthlyBudget || 0) }) || {};
    if (path === '/api/cost' && method === 'GET') return gateway.observability?.costControl?.snapshot?.({ tenantId, history: scopedRuns() }) || {};
    if (path === '/api/cost/pricing' && method === 'GET') return { pricing: gateway.observability?.pricing?.list?.() || {} };
    if (path === '/api/cost/pricing' && method === 'POST') return { pricing: gateway.observability?.pricing?.set?.(body.model, body.price || body) || null };
    if (path === '/api/cost/budgets' && method === 'POST') return { budgets: gateway.observability?.costControl?.configure?.(body.budgets || body) || {} };
    if (path === '/api/policies/bundles' && method === 'GET') return { bundles: bundleRegistry.list(query.name || body.name, tenantId) };
    if (path === '/api/policies/bundles/create' && method === 'POST') return { bundle: bundleRegistry.create(body.name, body.policies || {}, body.metadata || {}, tenantId) };
    if (path === '/api/policies/bundles/test' && method === 'POST') return { test: bundleRegistry.test(body.name, body.version, body.cases || [], tenantId) };
    if (path === '/api/policies/bundles/activate' && method === 'POST') { const bundle = bundleRegistry.activate(body.name, body.version, tenantId); if (!tenantId) Object.assign(gateway.policies, bundle.policies); gateway.events?.publish?.('policy.activated', { ...bundle, tenantId }); return { bundle }; }
    if (path === '/api/policies/bundles/diff' && method === 'GET') return { diff: bundleRegistry.diff(query.name, query.from, query.to, tenantId) };
    if (path === '/api/events' && method === 'GET') return { error: 'SSE endpoint' };
    const orgForTenant = (orgId) => { if (!tenantId) return saas.organizations.get(orgId); const links = saas.organizations.tenantsFor(orgId); return links.some(x => x.tenantId === tenantId) ? saas.organizations.get(orgId) : null; };
    if (path === '/api/organizations' && method === 'GET') return { organizations: tenantId ? saas.organizations.list().filter(o => saas.organizations.tenantsFor(o.id).some(x => x.tenantId === tenantId)) : saas.organizations.list() };
    if (path === '/api/organizations/create' && method === 'POST') return { organization: saas.organizations.create(body.name, { userId: body.userId || body.ownerId || body.email, metadata: body.metadata }) };
    if (path === '/api/organizations/plan' && method === 'POST') { if (!orgForTenant(body.orgId)) throw Object.assign(new Error('Organization not found'), { status: 404 }); return { organization: saas.organizations.setPlan(body.orgId, body.plan) }; }
    if (path === '/api/organizations/members' && method === 'GET') { if (!orgForTenant(query.orgId || body.orgId)) throw Object.assign(new Error('Organization not found'), { status: 404 }); return { members: saas.organizations.membersFor(query.orgId || body.orgId) }; }
    if (path === '/api/organizations/members/add' && method === 'POST') { if (!orgForTenant(body.orgId)) throw Object.assign(new Error('Organization not found'), { status: 404 }); return { member: saas.organizations.addMember(body.orgId, body.userId, body.role, body.metadata || {}) }; }
    if (path === '/api/organizations/tenants/link' && method === 'POST') { if (tenantId) { if (body.tenantId !== tenantId) throw Object.assign(new Error('Tenant mismatch'), { status: 403 }); } return { tenant: saas.organizations.linkTenant(body.orgId, scopedTenant(body.tenantId)) }; }
    if (path === '/api/organizations/usage' && method === 'GET') { const orgId=query.orgId || body.orgId; if (!orgForTenant(orgId)) throw Object.assign(new Error('Organization not found'), { status: 404 }); return { usage: saas.usage.snapshot(orgId, query.period || body.period) }; }
    if (path === '/api/organizations/entitlement' && method === 'GET') { const orgId=query.orgId || body.orgId; if (!orgForTenant(orgId)) throw Object.assign(new Error('Organization not found'), { status: 404 }); return { entitlement: saas.entitlements.check(orgId, query.metric || body.metric || 'runs', Number(query.additional || body.additional || 1)) }; }
    if (path === '/api/organizations/usage/consume' && method === 'POST') { if (!orgForTenant(body.orgId)) throw Object.assign(new Error('Organization not found'), { status: 404 }); return { usage: saas.entitlements.consume(body.orgId, body.metric || 'runs', Number(body.quantity || 1)) }; }
    if (path === '/api/billing/checkout' && method === 'POST') { if (!orgForTenant(body.orgId)) throw Object.assign(new Error('Organization not found'), { status: 404 }); return { checkout: await saas.billing.createCheckout({ orgId: body.orgId, plan: body.plan }) }; }
    if (path === '/api/billing/portal' && method === 'POST') { if (!orgForTenant(body.orgId)) throw Object.assign(new Error('Organization not found'), { status: 404 }); return { portal: await saas.billing.customerPortal({ orgId: body.orgId }) }; }
    if (path === '/api/tenants' && method === 'GET') return { tenants: tenantId ? [tenantRegistry.get(tenantId)].filter(Boolean) : tenantRegistry.list() };
    if (path === '/api/tenants/create' && method === 'POST') { if (tenantId) throw Object.assign(new Error('Platform scope required'), { status: 403 }); return { tenant: tenantRegistry.create(body.name, body.metadata || {}) }; }
    if (path === '/api/keys/issue' && method === 'POST') return { key: tenantRegistry.issueKey(scopedTenant(body.tenantId), body) };
    if (path === '/api/keys' && method === 'GET') return { keys: tenantRegistry.listKeys(scopedTenant(query.tenantId || body.tenantId)) };
    if (path === '/api/keys/revoke' && method === 'POST') return { key: tenantRegistry.revoke(body.keyId, tenantId) };
    if (path === '/api/keys/rotate' && method === 'POST') return { key: tenantRegistry.rotate(body.keyId, body, tenantId) };
    if (path === '/api/webhooks' && method === 'GET') return { webhooks: webhookRegistry.list(scopedTenant(query.tenantId || body.tenantId)) };
    if (path === '/api/webhooks/create' && method === 'POST') return { webhook: webhookRegistry.create(scopedTenant(body.tenantId), body) };
    if (path === '/api/webhooks/remove' && method === 'POST') return { webhook: webhookRegistry.remove(body.webhookId, scopedTenant(body.tenantId)) };
    if (path === '/api/webhooks/deliveries' && method === 'GET') return { deliveries: webhookRegistry.deliveriesFor(scopedTenant(query.tenantId || body.tenantId)) };
    if (path === '/api/webhooks/deliver' && method === 'POST') return { delivery: await webhookRegistry.deliver(body.deliveryId, scopedTenant(body.tenantId)) };
    if (path === '/api/runs') return { runs: scopedRuns() };
    if (path === '/api/agents') return { agents: tenantId ? agents.list(a => a.tenantId === tenantId) : agents.list() };
    if (path === '/api/agents/register' && method === 'POST') return { agent: registerAgent(body, tenantId) };
    if (path === '/api/policies' && method === 'GET') return { policies: policyRegistry ? policyRegistry.list(body.name || query.name, tenantId) : [] };
    if (path === '/api/policies/create' && method === 'POST') return { policy: policyRegistry.create(body.name, body.policy || {}, body.metadata || {}, tenantId) };
    if (path === '/api/policies/test' && method === 'POST') return { test: policyRegistry.test(body.name, body.version, body.cases || [], tenantId) };
    if (path === '/api/policies/activate' && method === 'POST') return { policy: (() => { const p = policyRegistry.activate(body.name, body.version, tenantId); if (!tenantId) Object.assign(gateway.policies, p.policy); return p; })() };
    if (path === '/api/policies/rollback' && method === 'POST') return { policy: (() => { const p = policyRegistry.rollback(body.name, body.version, tenantId); if (!tenantId) Object.assign(gateway.policies, p.policy); return p; })() };
    if (path === '/api/policies/diff' && method === 'GET') return { diff: policyRegistry.diff(query.name, query.from, query.to, tenantId) };
    if (path === '/api/policies/audit' && method === 'GET') return { audit: policyRegistry.auditLog(query.name, tenantId) };
    if (path === '/api/authorize' && method === 'POST') return { authorization: authorize(body, effectivePolicies(tenantId).authorization || {}) };
    if (path === '/api/attack-lab' && method === 'POST') {
      const results = await runGatewayAttackLab(gateway, { cases: Array.isArray(body.cases) && body.cases.length ? body.cases : undefined, toolMap: body.toolMap || undefined });
      return { summary: summarizeAttackResults(results), results };
    }
    if (path === '/api/audit/export' && method === 'GET') {
      const runs = scopedRuns();
      const approvals = scopedApprovals();
      const policies = policyRegistry?.auditLog?.(query.name || null, tenantId) || [];
      return { exportedAt: new Date().toISOString(), version: PACKAGE_VERSION, tenantId, runs, approvals, policies };
    }
    if (path === '/api/behavior') return analyzeBehavior(scopedRuns());
    if (path === '/api/blast-radius') return analyzeBlastRadius(scopedRuns());
    if (path === '/api/approvals') return { approvals: scopedApprovals(body.status || query.status) };
    if (path === '/api/security-report') {
      const report = generateSecurityReport({ runs: scopedRuns(), policies: gateway.policies || {} });
      return { report };
    }
    if (path === '/api/security-report.html') {
      const report = generateSecurityReport({ runs: scopedRuns(), policies: gateway.policies || {} });
      return { html: renderSecurityReportHTML(report), _html: true };
    }
    if (path.startsWith('/api/replay/')) return { run: gateway.replay(path.split('/').pop(), tenantId) };
    if (path === '/api/approvals/approve' && method === 'POST') return gateway.approve(body.approvalId, tenantId);
    if (path === '/api/approvals/deny' && method === 'POST') return gateway.deny(body.approvalId, body.reason, tenantId);
    return { error: 'Not found' };
  }

  const brandingAssets = {
    '/assets/branding/magon-logo.png': {
      file: 'assets/branding/magon-logo.png',
      type: 'image/png'
    },
    '/assets/branding/agentgate-logo.png': {
      file: 'assets/branding/agentgate-logo.png',
      type: 'image/png'
    }
  };

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    if (req.method === 'GET' && brandingAssets[url.pathname]) {
      const asset = brandingAssets[url.pathname];
      try {
        const data = await readFile(new URL(`../${asset.file}`, import.meta.url));
        res.writeHead(200, {
          'content-type': asset.type,
          'cache-control': 'public, max-age=86400'
        });
        res.end(data);
      } catch {
        res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
        res.end('Branding asset not found');
      }
      return;
    }
    if (url.pathname === '/' && req.method === 'GET' && staticHtml) {
      const headers = { 'content-type': 'text/html; charset=utf-8' };
      if (localDevSession) headers['set-cookie'] = `${localSessionCookie}=${localSessionToken}; HttpOnly; SameSite=Lax; Path=/`;
      res.writeHead(200, headers);
      res.end(staticHtml);
      return;
    }
    if (url.pathname === '/api/events' && req.method === 'GET') {
      const auth = authRequired ? (hasLocalSession(req) ? { ok: true, local: true } : authenticate(req, '/api/events', 'runs:read')) : { ok: true };
      if (!auth.ok) { res.writeHead(auth.status, {'content-type':'application/json','cache-control':'no-store'}); res.end(JSON.stringify({error:auth.error})); return; }
      res.writeHead(200, {'content-type':'text/event-stream; charset=utf-8','cache-control':'no-cache','connection':'keep-alive'});
      res.write(`event: ready\ndata: ${JSON.stringify({connectedAt:new Date().toISOString()})}\n\n`);
      const unsubscribe = gateway.events?.subscribe?.('*', message => { const eventTenant = message?.payload?.tenantId || message?.payload?.request?.tenantId || message?.tenantId; if (auth.tenantId && eventTenant && eventTenant !== auth.tenantId) return; if (auth.tenantId && !eventTenant) return; res.write(`event: ${message.event}\ndata: ${JSON.stringify(message)}\n\n`); });
      req.on('close', () => unsubscribe?.());
      return;
    }
    if (url.pathname.startsWith('/api/')) {
      let body = {};
      if (req.method === 'POST') {
        const maxBodySize = Number(options.maxBodySize || 1024 * 1024);
        try {
          body = await readJsonBody(req, maxBodySize);
        } catch (error) {
          // 'connection: close' on top of fully draining the body (above) is
          // belt-and-suspenders: it tells the client itself not to reuse this
          // socket, so even a client we haven't fully drained yet won't have
          // its next request misread on this connection.
          res.writeHead(error.status || 400, { 'content-type': 'application/json', 'cache-control': 'no-store', 'connection': 'close' });
          res.end(JSON.stringify({ error: error.message }));
          return;
        }
      }
      const limitKey = req.headers['x-agentgate-key'] || req.socket.remoteAddress || 'anonymous';
      const rate = limiter.check(String(limitKey));
      if (!rate.allowed) { res.writeHead(429, {'content-type':'application/json','cache-control':'no-store','retry-after':String(Math.ceil((Date.parse(rate.resetAt)-Date.now())/1000))}); res.end(JSON.stringify({error:'Rate limit exceeded', ...rate})); return; }
      const scopes = {
        '/api/runs':'runs:read','/api/approvals':'approvals:read','/api/approvals/approve':'approvals:resolve','/api/approvals/deny':'approvals:resolve',
        '/api/agents':'agents:read','/api/agents/register':'agents:write','/api/policies':'policies:read','/api/policies/create':'policies:write','/api/policies/test':'policies:write','/api/policies/activate':'policies:write','/api/policies/rollback':'policies:write','/api/policies/diff':'policies:read','/api/policies/audit':'policies:read',
        '/api/policies/bundles':'policies:read','/api/policies/bundles/create':'policies:write','/api/policies/bundles/test':'policies:write','/api/policies/bundles/activate':'policies:write','/api/policies/bundles/diff':'policies:read',
        '/api/webhooks':'webhooks:read','/api/observability':'runs:read','/api/trace':'runs:read','/api/efficiency':'runs:read','/api/behavior/correlation':'runs:read','/api/attack-lab':'runs:read','/api/audit/export':'runs:read','/api/cost':'runs:read','/api/cost/analytics':'runs:read','/api/cost/forecast':'runs:read','/api/cost/pricing':'runs:read','/api/cost/budgets':'admin:*','/api/organizations':'admin:*','/api/organizations/create':'admin:*','/api/organizations/plan':'admin:*','/api/organizations/members':'admin:*','/api/organizations/members/add':'admin:*','/api/organizations/tenants/link':'admin:*','/api/organizations/usage':'runs:read','/api/organizations/entitlement':'runs:read','/api/organizations/usage/consume':'runs:read','/api/billing/checkout':'admin:*','/api/billing/portal':'admin:*','/api/webhooks/create':'webhooks:write','/api/webhooks/remove':'webhooks:write','/api/webhooks/deliveries':'webhooks:read','/api/webhooks/deliver':'webhooks:write','/api/kill-switch':'admin:*','/api/tenants':'admin:*','/api/tenants/create':'admin:*','/api/keys':'admin:*','/api/keys/issue':'admin:*','/api/keys/revoke':'admin:*','/api/keys/rotate':'admin:*'
      };
      let scope = Object.entries(scopes).find(([prefix]) => url.pathname === prefix || url.pathname.startsWith(prefix + '/'))?.[1];
      if (url.pathname === '/api/cost/pricing' && req.method === 'POST') scope = 'admin:*';
      let authContext = {};
      if (authRequired) {
        const bootstrapCreate = url.pathname === '/api/tenants/create' && req.method === 'POST' && bootstrapToken && req.headers['x-agentgate-bootstrap'] === bootstrapToken && tenantRegistry.list().length === 0;
        const auth = bootstrapCreate ? { ok: true, bootstrap: true } : ((hasLocalSession(req) && (localSessionAdmin || scope !== 'admin:*')) ? { ok: true, local: true } : authenticate(req, url.pathname, scope));
        authContext = auth;
        if (!auth.ok) { res.writeHead(auth.status, {'content-type':'application/json','cache-control':'no-store'}); res.end(JSON.stringify({error:auth.error})); return; }
        if (auth.tenantId && body.tenantId && body.tenantId !== auth.tenantId) { res.writeHead(403, {'content-type':'application/json'}); res.end(JSON.stringify({error:'Tenant mismatch'})); return; }
        if (auth.tenantId) body.tenantId = auth.tenantId;
        if (auth.tenantId && url.searchParams.has('tenantId') && url.searchParams.get('tenantId') !== auth.tenantId) { res.writeHead(403, {'content-type':'application/json'}); res.end(JSON.stringify({error:'Tenant mismatch'})); return; }
        if (auth.tenantId) {
          const tenantRate = tenantLimiter.check(`tenant:${auth.tenantId}`);
          if (!tenantRate.allowed) { res.writeHead(429, {'content-type':'application/json','cache-control':'no-store','retry-after':String(Math.ceil((Date.parse(tenantRate.resetAt)-Date.now())/1000))}); res.end(JSON.stringify({error:'Tenant rate limit exceeded', ...tenantRate})); return; }
        }
      }
      const idempotencyHeader = req.headers['idempotency-key'];
      const idempotencyKey = idempotencyHeader && IDEMPOTENT_PATHS.has(url.pathname)
        ? `${authContext.tenantId || 'no-tenant'}:${url.pathname}:${idempotencyHeader}`
        : null;
      if (idempotencyKey) {
        const cached = idempotencyGet(idempotencyKey);
        if (cached) {
          res.writeHead(cached.status, { 'content-type': 'application/json', 'cache-control': 'no-store', 'idempotency-replayed': 'true' });
          res.end(JSON.stringify(cached.result));
          return;
        }
      }
      // A handler can throw instead of returning an error shape — most
      // notably a persistence write failure (disk full, permission denied)
      // surfacing straight out of gateway.approve()/registerAgent()/etc. An
      // uncaught throw inside this async request listener would otherwise
      // become an unhandled rejection, which (depending on Node's
      // unhandledRejection mode) can crash the *entire* process over one
      // failed write — turning a single request's disk-full error into a
      // full outage. Catch it here, answer that one request with 500, and
      // keep the server serving every other request.
      let result;
      try {
        result = await api(url.pathname, req.method, body, Object.fromEntries(url.searchParams.entries()), authContext);
      } catch (error) {
        console.error(`AgentGate control plane: unhandled error on ${req.method} ${url.pathname}:`, error);
        res.writeHead(500, { 'content-type': 'application/json', 'cache-control': 'no-store' });
        res.end(JSON.stringify({ error: 'Internal error', message: error.message, code: error.code || null }));
        return;
      }
      if (result._html) { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' }); res.end(result.html); return; }
      const status = result.error ? 404 : (url.pathname === '/api/ready' && result.ready === false ? 503 : 200);
      if (idempotencyKey) idempotencyPut(idempotencyKey, status, result);
      res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
      res.end(JSON.stringify(result));
      return;
    }
    res.writeHead(404, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not found' }));
  });
  return { server, gateway, api };
}
