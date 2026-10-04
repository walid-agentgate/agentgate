import { evaluate } from './policy-engine.js';

const REQUIRED_POLICY_FIELDS = ['productionBlock', 'autoApproveAmount', 'approvalAmount'];

export function validateAgentGateConfig(config = {}) {
  const errors = [];
  const warnings = [];
  if (!config || typeof config !== 'object' || Array.isArray(config)) errors.push('Configuration must be an object');
  const c = config && typeof config === 'object' ? config : {};
  if (c.mode && !['observe', 'enforce'].includes(c.mode)) errors.push('mode must be observe or enforce');
  if (c.agent !== undefined && (typeof c.agent !== 'string' || !c.agent.trim())) errors.push('agent must be a non-empty string');
  const p = c.policies || {};
  if (p.autoApproveAmount !== undefined && (!Number.isFinite(Number(p.autoApproveAmount)) || Number(p.autoApproveAmount) < 0)) errors.push('policies.autoApproveAmount must be a non-negative number');
  if (p.approvalAmount !== undefined && (!Number.isFinite(Number(p.approvalAmount)) || Number(p.approvalAmount) < 0)) errors.push('policies.approvalAmount must be a non-negative number');
  if (Number.isFinite(Number(p.autoApproveAmount)) && Number.isFinite(Number(p.approvalAmount)) && Number(p.autoApproveAmount) > Number(p.approvalAmount)) errors.push('autoApproveAmount cannot exceed approvalAmount');
  if (c.mode === 'observe') warnings.push('observe mode records decisions but does not enforce them');
  const unknownActionPolicy = p.unknownActionPolicy || 'ask';
  if (!['allow', 'ask', 'block'].includes(unknownActionPolicy)) errors.push('policies.unknownActionPolicy must be allow, ask, or block');
  if (c.mode === 'enforce' && unknownActionPolicy === 'allow') {
    errors.push('policies.unknownActionPolicy=allow is not permitted in enforce mode; use ask or block for a production-safe deny-by-default posture');
  } else if (unknownActionPolicy === 'allow') {
    warnings.push('unknownActionPolicy is explicitly "allow" — unrecognized action names can execute without AgentGate approval. Use "ask" or "block" unless another authorization boundary fully classifies every action.');
  }
  if (c.authRequired === false) warnings.push('authRequired=false is unsafe for non-local deployments');
  if (c.localDevSession === true && c.authRequired === false) warnings.push('localDevSession should not be combined with authRequired=false');
  return { valid: errors.length === 0, errors, warnings, checked: [...REQUIRED_POLICY_FIELDS] };
}

export function simulatePolicyMatrix({ policies = {}, cases = [] } = {}) {
  const matrix = cases.length ? cases : [
    { name: 'read', action: 'read', amount: 0, environment: 'production' },
    { name: 'small refund', action: 'refund', amount: 250, environment: 'production' },
    { name: 'large refund', action: 'refund', amount: 1200, environment: 'production' },
    { name: 'huge refund', action: 'refund', amount: 6000, environment: 'production' },
    { name: 'production delete', action: 'delete', amount: 0, environment: 'production' },
    { name: 'export', action: 'export_all', amount: 0, environment: 'production' }
  ];
  return matrix.map((input, index) => {
    const decision = evaluate(input, policies);
    return { index, name: input.name || `case-${index + 1}`, input, decision: decision.decision, risk: decision.risk, reason: decision.reason, winningRule: decision.winningRule || null, ruleTrace: decision.ruleTrace || [] };
  });
}

export function runDoctorChecks({ config = {}, gateway = null } = {}) {
  const configResult = validateAgentGateConfig(config);
  const checks = [
    { name: 'config', ok: configResult.valid, details: configResult },
    { name: 'runtime-mode', ok: gateway ? ['observe', 'enforce'].includes(gateway.mode) : ['observe', 'enforce'].includes(config.mode || 'enforce'), details: gateway ? { mode: gateway.mode } : { mode: config.mode || 'enforce', source: 'config-only preflight' } },
    { name: 'policy-engine', ok: simulatePolicyMatrix({ policies: gateway?.policies || config.policies || {} }).every(x => ['ALLOW', 'ASK', 'BLOCK'].includes(x.decision)), details: 'decision matrix' },
    { name: 'fail-closed-auth', ok: config.authRequired !== false || config.localDevSession === true, details: { authRequired: config.authRequired !== false } }
  ];
  return { ok: checks.every(x => x.ok), checks, warnings: configResult.warnings };
}
