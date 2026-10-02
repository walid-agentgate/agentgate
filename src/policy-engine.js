import { authorize } from './identity.js';

export const DECISIONS = Object.freeze({ ALLOW: 'ALLOW', ASK: 'ASK', BLOCK: 'BLOCK' });

const destructive = new Set(['delete','refund','publish','deploy','export_all','update_production']);
const readOnly = new Set(['read','search','list','get','fetch']);

// Characters that have no legitimate reason to appear in an action name and
// exist only to confuse logs/matching or to smuggle a control sequence past
// string-equality checks: NUL and other control bytes, zero-width/bidi
// override characters (can make "delete" *look* like something else when
// rendered, or hide characters entirely), the fullwidth-forms block (an
// adversarial test used "％ｅｘｐｏｒｔ" — fullwidth lookalikes of ASCII — to
// probe whether it matched "export"), and "../"-style path segments. This
// check is unconditional and always on (not an opt-in policy) because no
// real tool/action name is ever affected by it — unlike a strict allowlist
// regex, which IS opt-in below to avoid breaking existing naming schemes.
const UNSAFE_ACTION_NAME = new RegExp(
  '[\\x00-\\x1F\\x7F\\u200B-\\u200F\\u202A-\\u202E\\u2066-\\u2069\\uFEFF\\uFF00-\\uFFEF]|\\.\\.[\\/\\\\]'
);
// Opt-in, stricter allowlist for teams that control every action name they
// register: policies.strictActionNames: true requires lowercase
// ascii-identifier-shaped names. Off by default so existing naming schemes
// (mixed case, spaces, unicode brand/customer names, etc.) don't suddenly
// start failing on upgrade.
const STRICT_ACTION_NAME = /^[a-z][a-z0-9_.:-]{0,63}$/;

export function evaluate(input = {}, policies = {}) {
  const auth = authorize(input, policies.authorization);
  const trace = [{ id: 'authorization', matched: auth.decision === 'BLOCK', decision: auth.decision, reason: auth.reason, matchedRule: auth.matchedRule || null }];
  if (auth.decision === 'BLOCK') return decision('BLOCK', auth.reason, 96, { authorization: auth, ruleTrace: trace, winningRule: auth.matchedRule || 'authorization' });
  const rawAction = String(input.action || '');
  if (UNSAFE_ACTION_NAME.test(rawAction)) {
    return decision('BLOCK', 'Action name contains unsafe characters (control, bidi-override, fullwidth-form, or path-traversal)', 99, { ruleTrace: [...trace, { id: 'unsafe-action-name', matched: true, decision: 'BLOCK', reason: 'Action name contains unsafe characters' }], winningRule: 'unsafe-action-name' });
  }
  const action = rawAction.toLowerCase();
  if (policies.strictActionNames && !STRICT_ACTION_NAME.test(action)) {
    return decision('BLOCK', 'Action name does not match the required format under strictActionNames', 97, { ruleTrace: [...trace, { id: 'strict-action-name', matched: true, decision: 'BLOCK', reason: 'Action name does not match the required format under strictActionNames' }], winningRule: 'strict-action-name' });
  }
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
  // A tool's own registered metadata (set by whoever controls the tool list,
  // via registerTool({ actionClass, requiresApproval, environments })) is a
  // more trustworthy signal than the action *name* a caller's request
  // happens to send, because a caller can pick any action string it wants
  // but cannot edit another tool's registration. It sits below the admin's
  // own explicit blockActions/productionBlock/amount/approvalActions rules
  // above (those still win), but above name-based classification and
  // unknownActionPolicy below — this is what closes the "call the dangerous
  // tool under an action name the policy engine doesn't recognize" evasion.
  const toolMeta = input.toolMetadata;
  if (toolMeta) {
    if (Array.isArray(toolMeta.environments) && toolMeta.environments.length && !toolMeta.environments.includes(env)) {
      return decision('BLOCK', 'Tool is not permitted in this environment per its registered metadata', 93, { ruleTrace: [...trace, { id: 'tool-metadata-environment', matched: true, decision: 'BLOCK', reason: 'Tool is not permitted in this environment per its registered metadata' }], winningRule: 'tool-metadata-environment' });
    }
    if (toolMeta.actionClass === 'destructive' && policies.productionBlock && env === 'production') {
      return decision('BLOCK', 'Destructive production action is blocked (per tool registration metadata)', 90, { ruleTrace: [...trace, { id: 'tool-metadata-production-block', matched: true, decision: 'BLOCK', reason: 'Destructive production action is blocked (per tool registration metadata)' }], winningRule: 'tool-metadata-production-block' });
    }
    if (toolMeta.requiresApproval) {
      return decision('ASK', 'Approval required per tool registration metadata', 74, { ruleTrace: [...trace, { id: 'tool-metadata-approval', matched: true, decision: 'ASK', reason: 'Approval required per tool registration metadata' }], winningRule: 'tool-metadata-approval' });
    }
    if (toolMeta.actionClass === 'readOnly') {
      return decision('ALLOW', 'Read-only per tool registration metadata', 5, { ruleTrace: [...trace, { id: 'tool-metadata-readonly', matched: true, decision: 'ALLOW', reason: 'Read-only per tool registration metadata' }], winningRule: 'tool-metadata-readonly' });
    }
  }
  if (amount > 0 && amount > (policies.autoApproveAmount ?? 500)) {
    return decision('ASK', 'Amount exceeds the automatic approval threshold', 65, { ruleTrace: [...trace, { id: 'auto-approval-threshold', matched: true, decision: 'ASK', reason: 'Amount exceeds the automatic approval threshold' }], winningRule: 'auto-approval-threshold' });
  }
  if (readOnly.has(action)) return decision('ALLOW', 'Read-only action allowed', 5, { ruleTrace: [...trace, { id: 'readonly-allow', matched: true, decision: 'ALLOW', reason: 'Read-only action allowed' }], winningRule: 'readonly-allow' });
  if (destructive.has(action) && policies.requireApprovalForDestructive !== false) {
    return decision('ASK', 'Destructive action requires approval', 75, { ruleTrace: [...trace, { id: 'destructive-approval', matched: true, decision: 'ASK', reason: 'Destructive action requires approval' }], winningRule: 'destructive-approval' });
  }
  // The action name didn't match anything above: it isn't in the small
  // built-in destructive/read-only lists, and no explicit policy
  // (blockActions/approvalActions/amount rule) named it. That does NOT mean
  // it's safe — a tool or integration can use any action name it likes
  // ('grant_admin', 'drop_database', 'transfer_money', ...). `unknownActionPolicy`
  // controls what happens to it:
  //   - 'allow' (default, for backward compatibility): let it through, same
  //     as AgentGate has always done. `agentgate doctor` warns loudly when
  //     this is the effective setting so it's never a silent gap.
  //   - 'ask': require human approval for anything unrecognized.
  //   - 'block': refuse anything unrecognized outright — the strictest,
  //     deny-by-default option, recommended for production once every
  //     legitimate action name has been classified.
  const unknownActionPolicy = policies.unknownActionPolicy || 'allow';
  if (unknownActionPolicy === 'block') {
    return decision('BLOCK', 'Unrecognized action blocked by unknownActionPolicy', 88, { ruleTrace: [...trace, { id: 'unknown-action-block', matched: true, decision: 'BLOCK', reason: 'Unrecognized action blocked by unknownActionPolicy' }], winningRule: 'unknown-action-block' });
  }
  if (unknownActionPolicy === 'ask') {
    return decision('ASK', 'Unrecognized action requires approval by unknownActionPolicy', 68, { ruleTrace: [...trace, { id: 'unknown-action-ask', matched: true, decision: 'ASK', reason: 'Unrecognized action requires approval by unknownActionPolicy' }], winningRule: 'unknown-action-ask' });
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
