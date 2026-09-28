import { evaluate } from './policy-engine.js';
import { createPersistentRunStore, createPersistentApprovalStore } from './persistent-store.js';
import { createApprovalStore, createApprovalRequest, APPROVAL_STATUS } from './approval.js';

export class RunStore {
  constructor(limit = 25000) { this.limit = limit; this.runs = []; }
  add(event) { this.runs.unshift(event); if (this.runs.length > this.limit) this.runs.pop(); return event; }
  list() { return [...this.runs]; }
  get(id) { return this.runs.find(r => r.id === id); }
}

export function createRuntime(options = {}) {
  const policies = options.policies || {};
  const store = options.store || (options.persistence ? createPersistentRunStore({ filePath: options.persistence, limit: options.maxRuns || 25000 }) : new RunStore());
  const approvalStore = options.approvalStore || (options.persistence ? createPersistentApprovalStore({ filePath: options.approvalPersistence || `${options.persistence}.approvals.json`, limit: options.maxApprovals || options.maxRuns || 25000 }) : createApprovalStore({ limit: options.maxApprovals || options.maxRuns || 25000 }));
  const pending = new Map();
  const mode = options.mode || 'enforce'; // observe | enforce

  async function check(request = {}) {
    const result = evaluate(request, policies);
    const event = {
      id: `run_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      createdAt: new Date().toISOString(),
      mode,
      request: structuredCloneSafe(request),
      decision: result.decision,
      risk: result.risk,
      reason: result.reason,
      winningRule: result.winningRule || null,
      ruleTrace: result.ruleTrace || [],
      simulated: mode === 'observe' && result.decision !== 'ALLOW'
    };
    store.add(event);
    return event;
  }

  async function execute(tool, request = {}) {
    const event = await check(request);
    if (mode === 'enforce' && event.decision !== 'ALLOW') {
      if (event.decision === 'ASK') {
        const approval = createApprovalRequest({
          runId: event.id,
          tenantId: request.tenantId,
          request,
          decision: event.decision,
          risk: event.risk,
          reason: event.reason,
          metadata: { action: request.action || request.tool || null }
        }, approvalStore);
        event.status = 'pending_approval';
        event.approvalId = approval.id;
        pending.set(approval.id, { tool, request: structuredCloneSafe(request), event });
        approvalStore.save?.();
        store.save?.();
        return { status: 'approval_required', approvalId: approval.id, agentgate: event };
      }
      const error = new Error(`AgentGate blocked action: ${event.reason}`);
      error.code = 'AGENTGATE_BLOCKED'; error.agentgate = event; throw error;
    }
    const value = await tool(request);
    event.status = 'executed';
    event.executed = true;
    event.valuePreview = preview(value);
    store.save?.();
    return { status: 'executed', value, agentgate: event };
  }

  function approvals(status) { return approvalStore.list(status); }
  function getApproval(id) { return approvalStore.get(id); }

  async function approve(approvalId) {
    const approval = approvalStore.get(approvalId);
    if (!approval) return { ok: false, error: 'Approval not found' };
    if (approval.status !== APPROVAL_STATUS.PENDING) return { ok: false, error: `Approval is already ${approval.status}`, approval };
    const item = pending.get(approvalId);
    if (!item) return { ok: false, error: 'Pending approval execution is no longer available', approval };
    approval.status = APPROVAL_STATUS.APPROVED;
    approval.resolvedAt = new Date().toISOString();
    const { tool, request, event } = item;
    try {
      const value = await tool(request);
      event.status = 'executed';
      event.executed = true;
      event.approval = { status: approval.status, resolvedAt: approval.resolvedAt, approver: 'explicit' };
      event.valuePreview = preview(value);
      approvalStore.save?.();
      store.save?.();
      pending.delete(approvalId);
      return { ok: true, status: 'executed', value, approval, agentgate: event };
    } catch (error) {
      event.status = 'execution_error';
      event.executed = true;
      event.error = error?.message || String(error);
      approvalStore.save?.();
      store.save?.();
      pending.delete(approvalId);
      return { ok: true, status: 'execution_error', error: event.error, approval, agentgate: event };
    }
  }

  function deny(approvalId, reason = 'Denied by approver') {
    const approval = approvalStore.get(approvalId);
    if (!approval) return { ok: false, error: 'Approval not found' };
    if (approval.status !== APPROVAL_STATUS.PENDING) return { ok: false, error: `Approval is already ${approval.status}`, approval };
    const item = pending.get(approvalId);
    approval.status = APPROVAL_STATUS.DENIED;
    approval.resolvedAt = new Date().toISOString();
    approval.resolutionReason = reason;
    if (item) {
      item.event.status = 'denied';
      item.event.approval = { status: approval.status, resolvedAt: approval.resolvedAt, reason };
    }
    pending.delete(approvalId);
    approvalStore.save?.();
    store.save?.();
    return { ok: true, status: 'denied', approval, agentgate: item?.event || null };
  }

  return {
    check,
    execute,
    approve,
    deny,
    approvals,
    getApproval,
    runs: () => store.list(),
    replay: id => store.get(id),
    mode,
    policies
  };
}

function preview(value) {
  try { return JSON.stringify(value).slice(0, 500); } catch { return '[unserializable]'; }
}
function structuredCloneSafe(value) {
  try { return structuredClone(value); } catch { return JSON.parse(JSON.stringify(value)); }
}
