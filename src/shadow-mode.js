/**
 * Deterministic shadow-mode analysis for design partners.
 * Compares AgentGate's proposed decision with the action that actually occurred.
 */
export function recordShadowEvent({ decision, executed, request = {}, runId = null, actualError = null } = {}) {
  const proposed = String(decision || 'UNKNOWN').toUpperCase();
  const actual = executed ? 'EXECUTED' : (actualError ? 'ERROR' : 'NOT_EXECUTED');
  const mismatch = (proposed === 'BLOCK' && executed) || (proposed === 'ALLOW' && !executed && !actualError);
  return {
    runId,
    timestamp: new Date().toISOString(),
    proposedDecision: proposed,
    actualOutcome: actual,
    mismatch,
    request,
    actualError: actualError ? String(actualError.message || actualError) : null
  };
}

export function analyzeShadowEvents(events = []) {
  const list = Array.isArray(events) ? events : [];
  const counts = { ALLOW: 0, ASK: 0, BLOCK: 0, UNKNOWN: 0 };
  let wouldBlockExecuted = 0;
  let wouldAskExecuted = 0;
  let wouldAllowNotExecuted = 0;
  let errors = 0;
  for (const event of list) {
    const decision = counts[event.proposedDecision] !== undefined ? event.proposedDecision : 'UNKNOWN';
    counts[decision] += 1;
    if (event.proposedDecision === 'BLOCK' && event.actualOutcome === 'EXECUTED') wouldBlockExecuted += 1;
    if (event.proposedDecision === 'ASK' && event.actualOutcome === 'EXECUTED') wouldAskExecuted += 1;
    if (event.proposedDecision === 'ALLOW' && event.actualOutcome === 'NOT_EXECUTED') wouldAllowNotExecuted += 1;
    if (event.actualOutcome === 'ERROR') errors += 1;
  }
  const total = list.length;
  return {
    total,
    decisions: counts,
    wouldBlockExecuted,
    wouldAskExecuted,
    wouldAllowNotExecuted,
    errors,
    mismatchCount: wouldBlockExecuted + wouldAskExecuted + wouldAllowNotExecuted,
    mismatchRate: total ? (wouldBlockExecuted + wouldAskExecuted + wouldAllowNotExecuted) / total : 0,
    safeForEnforcement: wouldBlockExecuted === 0 && wouldAskExecuted === 0
  };
}
