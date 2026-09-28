import { createMCPGateway } from './mcp-gateway.js';
import { runGatewayAttackLab } from './attack-lab.js';
import { inspectEgress } from './egress-guard.js';
import { evaluate } from './policy-engine.js';
import { createControlPlane } from './control-plane.js';
import { TenantRegistry } from './multi-tenant.js';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

function result(name, ok, details = {}) { return { name, ok: Boolean(ok), details }; }

async function httpJson(url, options = {}) {
  const response = await fetch(url, options);
  let body = null;
  try { body = await response.json(); } catch { body = null; }
  return { status: response.status, body };
}

export async function runSecurityValidation(options = {}) {
  const counters = { read: 0, refund: 0, delete: 0, export_all: 0 };
  const gateway = options.gateway || createMCPGateway({
    mode: 'enforce',
    maxRuns: Number(options.maxRuns || 2000),
    policies: { productionBlock: true, approvalActions: ['refund'], approvalAmount: 5000, blockActions: ['export_all'] },
    tools: [
      { name: 'read', handler: async () => { counters.read++; return { ok: true }; } },
      { name: 'refund', handler: async args => { counters.refund++; return { refunded: args.amount }; } },
      { name: 'delete', handler: async () => { counters.delete++; return { deleted: true }; } },
      { name: 'export_all', handler: async () => { counters.export_all++; return { secret: 'SHOULD_NOT_RUN' }; } },
      { name: 'update_production', handler: async () => ({ changed: true }) },
      { name: 'publish', handler: async () => ({ published: true }) }
    ]
  });
  const checks = [];
  const attacks = await runGatewayAttackLab(gateway);
  checks.push(result('attack-lab', attacks.every(x => x.passed), { total: attacks.length, passed: attacks.filter(x => x.passed).length }));

  const beforeDelete = counters.delete;
  const blocked = await gateway.handle({ jsonrpc:'2.0', id:'validation-block', method:'tools/call', params:{ name:'delete', action:'delete', environment:'production', arguments:{ id:'x' }, agent:'validator', tenantId:'tenant_a' }});
  checks.push(result('pre-execution-block', blocked?.result?._agentgate?.decision?.decision === 'BLOCK' && counters.delete === beforeDelete, { decision: blocked?.result?._agentgate?.decision?.decision, handlerExecuted: counters.delete !== beforeDelete }));

  const beforeRefund = counters.refund;
  const ask = await gateway.handle({ jsonrpc:'2.0', id:'validation-ask', method:'tools/call', params:{ name:'refund', action:'refund', environment:'development', arguments:{ amount:1200 }, agent:'validator', tenantId:'tenant_a' }});
  const approvalId = ask.result?._agentgate?.approvalId;
  checks.push(result('approval-boundary', ask?.result?._agentgate?.decision?.decision === 'ASK' && counters.refund === beforeRefund && Boolean(approvalId), { decision: ask?.result?._agentgate?.decision?.decision, executed: counters.refund !== beforeRefund, approvalId }));

  const secret = inspectEgress(JSON.stringify({ token:'Bearer abcdefghijklmnopqrstuvwxyz123456', email:'x@example.com' }));
  checks.push(result('egress-detection', Array.isArray(secret?.findings) && secret.findings.length > 0, { findings: secret?.findings?.length || 0 }));

  const malformed = [null, {}, { action:null }, { action:'refund', amount:'not-a-number' }, { action:'delete', environment:123 }];
  const malformedResults = malformed.map(input => { try { const x = evaluate(input || {}, { productionBlock:true }); return ['ALLOW','ASK','BLOCK'].includes(x.decision); } catch { return false; } });
  checks.push(result('malformed-input-resilience', malformedResults.every(Boolean), { cases: malformedResults.length, passed: malformedResults.filter(Boolean).length }));

  const tenantA = gateway.runs('tenant_a');
  const tenantB = gateway.runs('tenant_b');
  checks.push(result('tenant-run-scope', tenantA.every(x => x.tenantId === 'tenant_a') && tenantB.every(x => x.tenantId === 'tenant_b'), { tenantA: tenantA.length, tenantB: tenantB.length }));

  const retention = gateway.retention?.() || {};
  checks.push(result('replay-retention-status', retention.limit >= 1000 && retention.count >= 1 && typeof retention.nearLimit === 'boolean', retention));

  // Exercise the actual HTTP control plane with two scoped tenant keys.
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'agentgate-validation-'));
  const registry = new TenantRegistry({ filePath: path.join(tempRoot, 'tenants.json'), keyPath: path.join(tempRoot, 'keys.json') });
  const tenantOne = registry.create('Validation A');
  const tenantTwo = registry.create('Validation B');
  const keyA = registry.issueKey(tenantOne.id, { scopes: ['runs:read'] }).secret;
  const keyB = registry.issueKey(tenantTwo.id, { scopes: ['runs:read'] }).secret;
  await gateway.handle({ jsonrpc:'2.0', id:'tenant-a-seed', method:'tools/call', params:{ name:'read', action:'read', environment:'development', arguments:{ seed:'A' }, tenantId:tenantOne.id }});
  await gateway.handle({ jsonrpc:'2.0', id:'tenant-b-seed', method:'tools/call', params:{ name:'read', action:'read', environment:'development', arguments:{ seed:'B' }, tenantId:tenantTwo.id }});
  const control = createControlPlane({ gateway, tenantRegistry: registry, authRequired: true, rateLimit: 100000, tenantRateLimit: 100000 });
  await new Promise((resolve, reject) => { control.server.listen(0, '127.0.0.1', resolve).on('error', reject); });
  const address = control.server.address();
  const base = `http://127.0.0.1:${address.port}`;
  try {
    const own = await httpJson(`${base}/api/runs`, { headers: { 'x-agentgate-key': keyA } });
    const crossQuery = await httpJson(`${base}/api/runs?tenantId=${encodeURIComponent(tenantTwo.id)}`, { headers: { 'x-agentgate-key': keyA } });
    const ownB = await httpJson(`${base}/api/runs`, { headers: { authorization: `Bearer ${keyB}` } });
    checks.push(result('tenant-cross-tenant-http', own.status === 200 && Array.isArray(own.body?.runs) && own.body.runs.every(r => r.tenantId === tenantOne.id) && crossQuery.status === 403 && ownB.status === 200 && Array.isArray(ownB.body?.runs) && ownB.body.runs.every(r => r.tenantId === tenantTwo.id), {
      tenantAStatus: own.status,
      tenantAVisibleTenants: [...new Set((own.body?.runs || []).map(r => r.tenantId))],
      crossTenantStatus: crossQuery.status,
      tenantBStatus: ownB.status,
      tenantBVisibleTenants: [...new Set((ownB.body?.runs || []).map(r => r.tenantId))]
    }));
  } finally {
    await new Promise(resolve => control.server.close(resolve));
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }

  return { ok: checks.every(x => x.ok), checks, attacks, counters, generatedAt: new Date().toISOString() };
}
