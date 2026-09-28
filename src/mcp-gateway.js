import http from 'node:http';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { evaluate } from './policy-engine.js';
import { createApprovalStore, createApprovalRequest, APPROVAL_STATUS } from './approval.js';
import { createPersistentRunStore, createPersistentApprovalStore } from './persistent-store.js';
import { createEventBus } from './event-bus.js';
import { createTelemetry } from './telemetry.js';
import { createEgressGuard } from './egress-guard.js';
import { createObservability, calculateCost, COST_DECISIONS } from './observability.js';

const require = createRequire(import.meta.url);
const PACKAGE_VERSION = require('../package.json').version;

export const MCP_PROTOCOL_VERSION = '2025-06-18';

function rpcResult(id, result) {
  return { jsonrpc: '2.0', id, result };
}
function rpcError(id, code, message, data) {
  const error = { code, message };
  if (data !== undefined) error.data = data;
  return { jsonrpc: '2.0', id, error };
}

export function createMCPGateway(options = {}) {
  const tools = new Map();
  const policies = options.policies || {};
  let policyResolverRef = typeof options.policyResolver === 'function' ? options.policyResolver : null;
  const mode = options.mode === 'observe' ? 'observe' : 'enforce';
  let killSwitch = Boolean(options.killSwitch);
  const killReason = { value: options.killReason || 'Emergency security lock' };
  const maxRuns = Number(options.maxRuns || 25000);
  let retentionWarned = false;
  const runStore = options.runStore || (options.persistence ? createPersistentRunStore({ filePath: options.runPersistence || `${options.persistence}/runs.json`, limit: maxRuns }) : null);
  const runs = runStore ? null : [];
  const approvals = createApprovalStore({ store: options.approvalStore || (options.persistence ? createPersistentApprovalStore({ filePath: options.approvalPersistence || `${options.persistence}/approvals.json`, limit: options.maxApprovals || maxRuns }) : undefined), limit: options.maxApprovals || maxRuns });
  const eventBus = options.eventBus || createEventBus();
  const telemetry = options.telemetry || createTelemetry();
  const egressGuard = options.egressGuard || (options.egress ? createEgressGuard(options.egress === true ? {} : options.egress) : null);
  const observability = options.observability || createObservability({ pricing: options.pricing || {}, budgets: options.budgets || options.costBudgets || {} });
  const serverInfo = {
    name: options.name || 'AgentGate Gateway',
    version: options.version || PACKAGE_VERSION
  };

  const api = {
    mode,
    policies,
    registerTool,
    handle,
    tools: () => [...tools.keys()],
    runs: (tenantId) => { const all = runStore ? runStore.list() : [...runs]; return tenantId ? all.filter(run => run.tenantId === tenantId) : all; },
    replay: (runId, tenantId) => { const run = runStore ? runStore.get(runId) : (runs.find((item) => item.id === runId) || null); return !tenantId || run?.tenantId === tenantId ? run : null; },
    approvals: (status, tenantId) => { const all = approvals.list(status); return tenantId ? all.filter(item => item.tenantId === tenantId) : all; },
    getApproval: (approvalId, tenantId) => { const item = approvals.get(approvalId); return !tenantId || item?.tenantId === tenantId ? item : null; },
    approve: (approvalId, tenantId) => resolveApproval(approvalId, true, undefined, tenantId),
    deny: (approvalId, reason, tenantId) => resolveApproval(approvalId, false, reason, tenantId),
    events: eventBus,
    telemetry,
    observability,
    setPolicyResolver(resolver) { policyResolverRef = typeof resolver === 'function' ? resolver : null; return api; },
    kill(reason = 'Emergency security lock') { killSwitch = true; killReason.value = String(reason); eventBus.publish('gateway.killed', { reason: killReason.value }); return { killed:true, reason:killReason.value }; },
    unkill() { killSwitch = false; eventBus.publish('gateway.unkilled', {}); return { killed:false }; },
    isKilled() { return killSwitch; },
    killStatus() { return { killed:killSwitch, reason:killReason.value }; },
    egressGuard,
    retention: () => {
      const count = runStore ? runStore.list().length : runs.length;
      const nearLimit = count >= Math.max(1, Math.ceil(maxRuns * 0.9));
      return { count, limit: maxRuns, nearLimit, persistent: Boolean(runStore), truncated: count >= maxRuns };
    }
  };

  for (const tool of options.tools || []) registerTool(tool);

  function registerTool(tool) {
    if (!tool?.name || typeof tool.handler !== 'function') {
      throw new TypeError('registerTool() expects { name, handler, description?, inputSchema? }');
    }
    tools.set(tool.name, {
      name: tool.name,
      description: tool.description || '',
      inputSchema: tool.inputSchema || { type: 'object' },
      handler: tool.handler
    });
    return api;
  }

  function record(event) {
    if (runStore) {
      const added = runStore.add(event);
      const count = runStore.list().length;
      if (!retentionWarned && count >= Math.max(1, Math.ceil(maxRuns * 0.9))) {
        retentionWarned = true;
        eventBus.publish('runs.retention.warning', { count, limit: maxRuns, persistent: true, message: 'Run history is approaching its retention limit; older runs may be evicted.' });
      }
      return added;
    }
    runs.push(event);
    if (runs.length > maxRuns) runs.splice(0, runs.length - maxRuns);
    const count = runs.length;
    if (!retentionWarned && count >= Math.max(1, Math.ceil(maxRuns * 0.9))) {
      retentionWarned = true;
      eventBus.publish('runs.retention.warning', { count, limit: maxRuns, persistent: false, message: 'Run history is approaching its retention limit; older runs may be evicted.' });
    }
    return event;
  }

  async function callTool(id, params = {}) {
    const name = params.name;
    const tool = tools.get(name);
    if (!tool) return rpcError(id, -32602, `Unknown tool: ${name}`);

    const input = params.arguments || {};
    const request = {
      ...input,
      tenantId: params.tenantId || params.context?.tenantId || options.tenantId || null,
      agent: params.agent || options.agent || params.identity?.agentId || params.identity?.agent || 'unknown',
      userId: params.userId || params.identity?.userId || params.identity?.user,
      identity: params.identity || params.context?.identity || options.identity,
      roles: params.roles || params.identity?.roles,
      attributes: params.attributes || params.identity?.attributes,
      resource: params.resource || input.resource,
      environment: params.environment || input.environment || options.environment || 'production',
      tool: name,
      action: params.action || name,
      model: params.model || params.context?.model || input.model,
      usage: params.usage || params.context?.usage || input.usage,
      estimatedCost: params.estimatedCost ?? params.context?.estimatedCost ?? input.estimatedCost,
      context: params.context || {}
    };
    if (killSwitch && mode === 'enforce') {
      const run = { id: randomUUID(), createdAt:new Date().toISOString(), tenantId:request.tenantId, request, decision:'BLOCK', risk:100, reason:killReason.value, mode, killed:true };
      record(run); eventBus.publish('run.decided', run);
      return rpcResult(id, { isError:true, content:[{type:'text',text:`AgentGate emergency stop: ${killReason.value}`}], _agentgate:{runId:run.id, decision:{decision:'BLOCK',risk:100,reason:killReason.value}, killed:true} });
    }
    const effectivePolicies = policyResolverRef ? (policyResolverRef(request) || {}) : policies;
    const policyDecision = evaluate(request, effectivePolicies);
    const usageCost = request.usage ? calculateCost({ model: request.model || request.usage?.model, usage: request.usage }, observability.pricing.list()) : { known: false, total: 0 };
    const estimatedCost = Number(request.estimatedCost ?? usageCost.total ?? 0) || 0;
    const history = runStore ? runStore.list() : [...runs];
    const costDecision = estimatedCost > 0 ? observability.costControl.evaluate({ tenantId: request.tenantId, agent: request.agent, estimatedCost, history }) : { decision: COST_DECISIONS.ALLOW, reason: 'No estimated cost supplied' };
    const decision = policyDecision.decision === 'BLOCK' || costDecision.decision === 'BLOCK'
      ? { ...policyDecision, decision: 'BLOCK', risk: Math.max(policyDecision.risk, costDecision.decision === 'BLOCK' ? 94 : 0), reason: policyDecision.decision === 'BLOCK' ? policyDecision.reason : costDecision.reason }
      : policyDecision.decision === 'ASK' || costDecision.decision === 'ASK'
        ? { ...policyDecision, decision: 'ASK', risk: Math.max(policyDecision.risk, costDecision.decision === 'ASK' ? 72 : 0), reason: policyDecision.decision === 'ASK' ? policyDecision.reason : costDecision.reason }
        : policyDecision;
    const run = {
      id: randomUUID(),
      createdAt: new Date().toISOString(),
      tenantId: request.tenantId,
      request,
      decision: decision.decision,
      risk: decision.risk,
      reason: decision.reason,
      winningRule: decision.winningRule || null,
      ruleTrace: decision.ruleTrace || [],
      mode,
      simulated: mode === 'observe' && decision.decision !== 'ALLOW',
      cost: { ...usageCost, estimated: estimatedCost, budget: costDecision }
    };
    record(run);
    observability.enrichRun(run);
    runStore?.save?.();
    telemetry.increment('runs.recorded');
    telemetry.increment(`decisions.${decision.decision.toLowerCase()}`);
    eventBus.publish('run.recorded', run);

    if (mode === 'enforce' && decision.decision === 'BLOCK') {
      eventBus.publish('run.decided', run);
      return rpcResult(id, {
        isError: true,
        content: [{ type: 'text', text: `AgentGate blocked tool call: ${decision.reason}` }],
        _agentgate: { runId: run.id, decision }
      });
    }
    if (mode === 'enforce' && decision.decision === 'ASK') {
      const approval = createApprovalRequest({
        runId: run.id,
        tenantId: request.tenantId,
        request,
        decision: decision.decision,
        risk: decision.risk,
        reason: decision.reason,
        metadata: { tool: name, rpcRequestId: id, arguments: clone(input) }
      }, approvals);
      run.status = 'pending_approval';
      eventBus.publish('approval.created', { runId: run.id, approvalId: approval.id, tenantId: run.tenantId });
      run.approvalId = approval.id;
      return rpcResult(id, {
        isError: true,
        content: [{ type: 'text', text: `AgentGate approval required: ${decision.reason}` }],
        _agentgate: { runId: run.id, decision, approvalRequired: true, approvalId: approval.id, approval }
      });
    }

    try {
      const started = Date.now();
      const value = await tool.handler(input, { request, decision, runId: run.id });
      run.executed = true;
      run.durationMs = Date.now() - started;
      telemetry.observe('tool.execution', run.durationMs);
      telemetry.increment('tools.executed');
      observability.enrichRun(run);
      let outputValue = value;
      let egress = null;
      if (egressGuard) {
        egress = egressGuard.guard(value);
        run.egress = { action: egress.action, findings: egress.findings, risk: egress.risk, reason: egress.reason };
        telemetry.increment(`egress.${egress.action.toLowerCase()}`);
        if (egress.action === 'BLOCK') {
          run.egressBlocked = true;
          runStore?.save?.();
          eventBus.publish('egress.blocked', { runId: run.id, tenantId: run.tenantId, findings: egress.findings });
          return rpcResult(id, {
            isError: true,
            content: [{ type: 'text', text: `AgentGate blocked data egress: ${egress.reason}` }],
            _agentgate: { runId: run.id, decision, egress: { action: egress.action, findings: egress.findings, risk: egress.risk } }
          });
        }
        outputValue = egress.value;
        if (egress.action === 'REDACT') eventBus.publish('egress.redacted', { runId: run.id, tenantId: run.tenantId, findings: egress.findings });
      }
      run.valuePreview = typeof outputValue === 'string' ? outputValue.slice(0, 500) : outputValue;
      runStore?.save?.();
      return rpcResult(id, {
        content: [{ type: 'text', text: typeof outputValue === 'string' ? outputValue : JSON.stringify(outputValue) }],
        _agentgate: { runId: run.id, decision, simulated: run.simulated, ...(egress ? { egress: { action: egress.action, findings: egress.findings, risk: egress.risk } } : {}) }
      });
    } catch (error) {
      run.executed = true;
      run.error = error?.message || String(error);
      run.durationMs = Number.isFinite(run.durationMs) ? run.durationMs : undefined;
      observability.enrichRun(run);
      runStore?.save?.();
      telemetry.increment('tools.errors');
      return rpcResult(id, {
        isError: true,
        content: [{ type: 'text', text: run.error }],
        _agentgate: { runId: run.id, decision }
      });
    }
  }


  async function resolveApproval(approvalId, approved, denialReason, tenantId) {
    const approval = approvals.get(approvalId);
    if (tenantId && approval?.tenantId !== tenantId) return { ok: false, error: 'Approval not found' };
    if (!approval) return { ok: false, error: 'Approval not found' };
    if (approval.status !== APPROVAL_STATUS.PENDING) return { ok: false, error: `Approval is already ${approval.status}`, approval };
    const run = (runStore ? runStore.get(approval.runId) : runs.find(item => item.id === approval.runId));
    if (!run) return { ok: false, error: 'Run not found', approval };
    if (!approved) {
      approval.status = APPROVAL_STATUS.DENIED;
      approval.resolvedAt = new Date().toISOString();
      approval.resolutionReason = denialReason || 'Denied by approver';
      run.status = 'denied';
      run.approval = { status: approval.status, resolvedAt: approval.resolvedAt, reason: approval.resolutionReason };
      eventBus.publish('approval.resolved', { approvalId, runId: run.id, status: approval.status, tenantId: run.tenantId });
      approvals.save?.();
      runStore?.save?.();
      return { ok: true, status: 'denied', approval, run };
    }
    const tool = tools.get(approval.metadata.tool);
    if (!tool) return { ok: false, error: `Tool no longer registered: ${approval.metadata.tool}`, approval };
    approval.status = APPROVAL_STATUS.APPROVED;
    approval.resolvedAt = new Date().toISOString();
    run.status = 'approved';
    try {
      const started = Date.now();
      const value = await tool.handler(approval.metadata.arguments || {}, { request: approval.request, decision: { decision: run.decision, risk: run.risk, reason: run.reason }, runId: run.id, approved: true, approvalId });
      run.executed = true;
      run.durationMs = Date.now() - started;
      observability.enrichRun(run);
      let outputValue = value;
      if (egressGuard) {
        const egress = egressGuard.guard(value);
        run.egress = { action: egress.action, findings: egress.findings, risk: egress.risk, reason: egress.reason };
        telemetry.increment(`egress.${egress.action.toLowerCase()}`);
        if (egress.action === 'BLOCK') {
          run.egressBlocked = true;
          run.status = 'egress_blocked';
          eventBus.publish('egress.blocked', { runId: run.id, tenantId: run.tenantId, findings: egress.findings });
          approvals.save?.(); runStore?.save?.();
          return { ok: false, status: 'egress_blocked', approval, run, error: egress.reason };
        }
        outputValue = egress.value;
        if (egress.action === 'REDACT') eventBus.publish('egress.redacted', { runId: run.id, tenantId: run.tenantId, findings: egress.findings });
      }
      run.status = 'executed';
      run.valuePreview = typeof outputValue === 'string' ? outputValue.slice(0, 500) : outputValue;
      run.approval = { status: approval.status, resolvedAt: approval.resolvedAt, approver: 'explicit' };
      eventBus.publish('approval.resolved', { approvalId, runId: run.id, status: approval.status, tenantId: run.tenantId });
      approvals.save?.();
      runStore?.save?.();
      return { ok: true, status: 'executed', value: outputValue, approval, run };
    } catch (error) {
      run.executed = true;
      run.status = 'execution_error';
      run.error = error?.message || String(error);
      approvals.save?.();
      runStore?.save?.();
      return { ok: true, status: 'execution_error', error: run.error, approval, run };
    }
  }

  async function handle(message) {
    if (!message || message.jsonrpc !== '2.0') return rpcError(message?.id ?? null, -32600, 'Invalid Request');
    const { id, method, params } = message;
    if (id === undefined) return null; // notification

    if (method === 'initialize') {
      return rpcResult(id, {
        protocolVersion: params?.protocolVersion || MCP_PROTOCOL_VERSION,
        capabilities: { tools: {} },
        serverInfo
      });
    }
    if (method === 'ping') return rpcResult(id, {});
    if (method === 'tools/list') {
      return rpcResult(id, {
        tools: [...tools.values()].map(({ name, description, inputSchema }) => ({ name, description, inputSchema }))
      });
    }
    if (method === 'tools/call') return callTool(id, params);
    if (method === 'agentgate/approvals/list') return rpcResult(id, { approvals: api.approvals(params?.status, params?.tenantId) });
    if (method === 'agentgate/approvals/approve') return rpcResult(id, await resolveApproval(params?.approvalId, true, undefined, params?.tenantId));
    if (method === 'agentgate/approvals/deny') return rpcResult(id, await resolveApproval(params?.approvalId, false, params?.reason, params?.tenantId));
    return rpcError(id, -32601, `Method not found: ${method}`);
  }

  return api;
}

function clone(value) { try { return structuredClone(value); } catch { return JSON.parse(JSON.stringify(value)); } }

export function createMCPGatewayServer(options = {}) {
  const gateway = options.gateway || createMCPGateway(options);
  const server = http.createServer(async (req, res) => {
    if (req.method !== 'POST' || req.url !== (options.path || '/mcp')) {
      res.writeHead(404, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'Not found' }));
      return;
    }
    if (typeof options.authenticate !== 'function' && options.localOnly !== false) {
      const remote = String(req.socket.remoteAddress || '');
      const loopback = remote === '127.0.0.1' || remote === '::1' || remote === '::ffff:127.0.0.1';
      if (!loopback) { res.writeHead(403, { 'content-type': 'application/json' }); res.end(JSON.stringify({ error: 'MCP server is local-only unless authentication is configured' })); return; }
    }
    if (options.localOnly === false && typeof options.authenticate !== 'function') {
      res.writeHead(401, { 'content-type': 'application/json' }); res.end(JSON.stringify({ error: 'Authentication is required for non-local MCP server' })); return;
    }
    const maxBodySize = Number(options.maxBodySize || 1024 * 1024);
    if (typeof options.authenticate === 'function') {
      const auth = await options.authenticate(req);
      if (!auth?.ok) { res.writeHead(auth?.status || 401, { 'content-type': 'application/json' }); res.end(JSON.stringify({ error: auth?.error || 'Unauthorized' })); return; }
      if (auth.tenantId) req.agentgateTenantId = auth.tenantId;
    }
    let body = '';
    let size = 0;
    req.on('data', chunk => { size += chunk.length; if (size > maxBodySize) { req.destroy(); return; } body += chunk; });
    req.on('end', async () => {
      if (size > maxBodySize) { res.writeHead(413, { 'content-type': 'application/json' }); res.end(JSON.stringify({ error: 'Payload too large' })); return; }
      try {
        const message = JSON.parse(body || '{}');
        if (req.agentgateTenantId && message?.params) message.params.tenantId = req.agentgateTenantId;
        const response = await gateway.handle(message);
        if (response === null) {
          res.writeHead(202);
          res.end();
          return;
        }
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify(response));
      } catch (error) {
        res.writeHead(400, { 'content-type': 'application/json' });
        res.end(JSON.stringify(rpcError(null, -32700, error.message)));
      }
    });
  });
  return { server, gateway };
}
