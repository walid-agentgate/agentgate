import { DECISIONS } from './policy-engine.js';

/**
 * Convert attack results into deterministic, reviewable policy suggestions.
 * Suggestions are data only; AgentGate never auto-authorizes from them.
 */
export function generatePolicySuggestions(results = []) {
  const suggestions = [];
  const blocked = new Set();
  const approval = new Set();

  for (const result of results) {
    const action = String(result.action || '').toLowerCase();
    if (!action) continue;

    if (result.decision === DECISIONS.BLOCK) {
      blocked.add(action);
      suggestions.push({
        id: `block-${action}`,
        type: 'block_action',
        action,
        reason: result.reason || 'Attack was blocked by AgentGate',
        confidence: 0.98
      });
    } else if (result.decision === DECISIONS.ASK) {
      approval.add(action);
      suggestions.push({
        id: `approval-${action}`,
        type: 'require_approval',
        action,
        reason: result.reason || 'Attack requires human approval',
        confidence: 0.92
      });
    } else if (result.risk >= 70) {
      approval.add(action);
      suggestions.push({
        id: `review-${action}`,
        type: 'require_approval',
        action,
        reason: 'High-risk action should require review',
        confidence: 0.85
      });
    }
  }

  const policy = {};
  if (blocked.size) policy.blockActions = [...blocked].sort();
  if (approval.size) policy.approvalActions = [...approval].filter(a => !blocked.has(a)).sort();

  return { policy, suggestions: dedupe(suggestions) };
}

export function mergePolicies(base = {}, generated = {}) {
  return {
    ...base,
    ...generated,
    blockActions: unique([...(base.blockActions || []), ...(generated.blockActions || [])]),
    approvalActions: unique([...(base.approvalActions || []), ...(generated.approvalActions || [])])
      .filter(action => !(generated.blockActions || []).includes(action) && !(base.blockActions || []).includes(action))
  };
}

function unique(values) {
  return [...new Set(values.map(value => String(value).toLowerCase()))];
}

function dedupe(items) {
  const seen = new Set();
  return items.filter(item => {
    if (seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  });
}
