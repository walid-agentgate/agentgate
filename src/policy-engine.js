import { authorize } from './identity.js';

export const DECISIONS = Object.freeze({ ALLOW: 'ALLOW', ASK: 'ASK', BLOCK: 'BLOCK' });

const destructive = new Set(['delete','refund','publish','deploy','export_all','update_production']);
const readOnly = new Set(['read','search','list','get','fetch']);

export function evaluate(input = {}, policies = {}) {
  const auth = authorize(input, policies.authorization);
  const trace = [{ id: 'authorization', matched: auth.decision === 'BLOCK', decision: auth.decision, reason: auth.reason, matchedRule: auth.matchedRule || null }];
  if (auth.decision === 'BLOCK') return decision('BLOCK', auth.reason, 96, { authorization: auth, ruleTrace: trace, winningRule: auth.matchedRule || 'authorization' });
  const action = String(input.action || '').toLowerCase();
  const hasAmount = Object.prototype.hasOwnProperty.call(input, 'amount') && input.amount !== undefined && input.amount !== null;
  if (hasAmount && (typeof input.amount !== 'number' || !Number.isFinite(input.amount) || input.amount < 0)) {
    return decision('BLOCK', 'Amount must be a finite non-negative number', 98, { ruleTrace: [...trace, { id: 'invalid-amount', matched: true, decision: 'BLOCK', reason: 'Amount must be a finite non-negative number' }], winningRule: 'invalid-amount' });
  }
  const amount = hasAmount ? input.amount : 0;
  const env = input.environment || 'production';

  if (policies.blockActions?.includes(action) || action === 'export_all') {
    return decision('BLOCK', 'Action explicitly blocked by policy', 95, { ruleTrace: [...trace, { id: 'explicit-block', matched: true, decision: 'BLOCK', reason: 'Action explicitly blocked by policy' }], winningRule: 'explicit-block' });
  }
  if (policies.productionBlock && env === 'production' && destructive.has(action)) {
    return decision('BLOCK', 'Destructive production action is blocked', 90, { ruleTrace: [...trace, { id: 'production-block', matched: true, decision: 'BLOCK', reason: 'Destructive production action is blocked' }], winningRule: 'production-block' });
  }
  if (amount > 0 && amount > (policies.approvalAmount ?? 5000)) {
    return decision('BLOCK', 'Amount exceeds the maximum permitted threshold', 92, { ruleTrace: [...trace, { id: 'approval-amount-hard', matched: true, decision: 'BLOCK', reason: 'Amount exceeds the maximum permitted threshold' }], winningRule: 'approval-amount-hard' });
  }
  if (policies.approvalActions?.includes(action)) {
    return decision('ASK', 'Approval required for sensitive action', 70, { ruleTrace: [...trace, { id: 'approval-action', matched: true, decision: 'ASK', reason: 'Approval required for sensitive action' }], winningRule: 'approval-action' });
  }
  if (amount > 0 && amount > (policies.autoApproveAmount ?? 500)) {
    return decision('ASK', 'Amount exceeds the automatic approval threshold', 65, { ruleTrace: [...trace, { id: 'auto-approval-threshold', matched: true, decision: 'ASK', reason: 'Amount exceeds the automatic approval threshold' }], winningRule: 'auto-approval-threshold' });
  }
  if (readOnly.has(action)) return decision('ALLOW', 'Read-only action allowed', 5, { ruleTrace: [...trace, { id: 'readonly-allow', matched: true, decision: 'ALLOW', reason: 'Read-only action allowed' }], winningRule: 'readonly-allow' });
  if (destructive.has(action) && policies.requireApprovalForDestructive !== false) {
    return decision('ASK', 'Destructive action requires approval', 75, { ruleTrace: [...trace, { id: 'destructive-approval', matched: true, decision: 'ASK', reason: 'Destructive action requires approval' }], winningRule: 'destructive-approval' });
  }
  return decision('ALLOW', 'No blocking policy matched', 10, { ruleTrace: [...trace, { id: 'default-allow', matched: true, decision: 'ALLOW', reason: 'No blocking policy matched' }], winningRule: 'default-allow' });
}

function decision(decision, reason, risk, extra = {}) {
  return { decision, reason, risk, timestamp: new Date().toISOString(), ...extra };
}

export function protect(tool, options = {}) {
  if (typeof tool !== 'function') throw new TypeError('protect() expects a function');
  const policies = {
    autoApproveAmount: 500,
    approvalAmount: 5000,
    ...options
  };
  return async function protectedTool(input = {}, context = {}) {
    const result = evaluate({ ...input, ...context }, policies);
    if (result.decision === 'BLOCK') {
      const error = new Error(`AgentGate blocked action: ${result.reason}`);
      error.code = 'AGENTGATE_BLOCKED';
      error.agentgate = result;
      throw error;
    }
    if (result.decision === 'ASK') {
      return { status: 'approval_required', agentgate: result };
    }
    const value = await tool(input);
    return { status: 'executed', value, agentgate: result };
  };
}
