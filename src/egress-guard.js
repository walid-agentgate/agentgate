const SENSITIVE_FIELD_NAMES = /^(?:secret|password|passphrase|private[_-]?key|access[_-]?token|refresh[_-]?token|authorization|auth[_-]?token|client[_-]?secret|api[_-]?secret|api[_-]?key|apikey)$/i;

const DEFAULT_RULES = Object.freeze({
  api_key: { action: 'BLOCK', patterns: [/(?:sk-[A-Za-z0-9_-]{16,})/g, /(?:AKIA|ASIA)[A-Z0-9]{16}/g], replacement: '[REDACTED:API_KEY]' },
  private_key: { action: 'BLOCK', patterns: [/-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/g], replacement: '[REDACTED:PRIVATE_KEY]' },
  bearer_token: { action: 'BLOCK', patterns: [/\bBearer\s+[A-Za-z0-9._~+/=-]{20,}/gi], replacement: 'Bearer [REDACTED:TOKEN]' },
  jwt: { action: 'BLOCK', patterns: [/(?:eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,})/g], replacement: '[REDACTED:JWT]' },
  email: { action: 'REDACT', patterns: [/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi], replacement: '[REDACTED:EMAIL]' },
  phone: { action: 'REDACT', patterns: [/(?<!\d)(?:\+?\d[\d\s().-]{7,}\d)(?!\d)/g], replacement: '[REDACTED:PHONE]' },
  credit_card: { action: 'BLOCK', patterns: [/(?<!\d)(?:\d[ -]*?){13,19}(?!\d)/g], replacement: '[REDACTED:CARD]' }
});

export const EGRESS_ACTIONS = Object.freeze({ ALLOW: 'ALLOW', REDACT: 'REDACT', BLOCK: 'BLOCK' });

function clone(value) {
  try { return structuredClone(value); } catch { return JSON.parse(JSON.stringify(value)); }
}

function stringifyForScan(value) {
  if (typeof value === 'string') return value;
  try { return JSON.stringify(value); } catch { return String(value); }
}

function walkAndTransform(value, transform, path = '$') {
  if (typeof value === 'string') return transform(value, path);
  if (Array.isArray(value)) return value.map((item, i) => walkAndTransform(item, transform, `${path}[${i}]`));
  if (value && typeof value === 'object') {
    const out = {};
    for (const [key, item] of Object.entries(value)) out[key] = walkAndTransform(item, transform, `${path}.${key}`);
    return out;
  }
  return value;
}

function normalizeRules(rules = {}) {
  const merged = { ...DEFAULT_RULES };
  for (const [type, rule] of Object.entries(rules || {})) {
    if (rule === false) { delete merged[type]; continue; }
    if (rule && typeof rule === 'object') merged[type] = { ...(merged[type] || {}), ...rule };
  }
  return merged;
}

function sensitiveFieldFindings(value, path = '$', findings = []) {
  if (!value || typeof value !== 'object') return findings;
  if (Array.isArray(value)) {
    value.forEach((item, index) => sensitiveFieldFindings(item, `${path}[${index}]`, findings));
    return findings;
  }
  for (const [key, item] of Object.entries(value)) {
    const childPath = `${path}.${key}`;
    if (SENSITIVE_FIELD_NAMES.test(key) && item !== null && item !== undefined && String(item).length > 0) {
      findings.push({ type: 'generic_secret', action: EGRESS_ACTIONS.BLOCK, count: 1, path: childPath });
    }
    sensitiveFieldFindings(item, childPath, findings);
  }
  return findings;
}

function sensitiveFieldFindingFromText(text) {
  const findings = [];
  const pattern = /[\"'](?:secret|password|passphrase|private[_-]?key|access[_-]?token|refresh[_-]?token|authorization|auth[_-]?token|client[_-]?secret|api[_-]?secret|api[_-]?key|apikey)[\"']\s*:\s*[\"']([^\"']+)[\"']/gi;
  for (const match of text.matchAll(pattern)) findings.push({ type: 'generic_secret', action: EGRESS_ACTIONS.BLOCK, count: 1 });
  return findings;
}

export function inspectEgress(value, options = {}) {
  const rules = normalizeRules(options.rules);
  const findings = sensitiveFieldFindings(value);
  const text = stringifyForScan(value);
  if (!findings.length || typeof value === 'string') findings.push(...sensitiveFieldFindingFromText(text));
  for (const [type, rule] of Object.entries(rules)) {
    for (const pattern of rule.patterns || []) {
      pattern.lastIndex = 0;
      const matches = text.match(pattern);
      if (matches?.length) findings.push({ type, action: rule.action || EGRESS_ACTIONS.BLOCK, count: matches.length });
    }
  }
  const action = findings.some(f => f.action === EGRESS_ACTIONS.BLOCK)
    ? EGRESS_ACTIONS.BLOCK
    : findings.length ? EGRESS_ACTIONS.REDACT : EGRESS_ACTIONS.ALLOW;
  return { action, findings, risk: action === EGRESS_ACTIONS.BLOCK ? 95 : action === EGRESS_ACTIONS.REDACT ? 70 : 0 };
}

export function guardEgress(value, options = {}) {
  const rules = normalizeRules(options.rules);
  const findings = [];
  let blocked = false;
  const transformed = walkAndTransform(clone(value), (input, path) => {
    let output = input;
    const fieldName = path.split('.').pop() || '';
    if (SENSITIVE_FIELD_NAMES.test(fieldName) && output !== null && typeof output !== 'object' && String(output).length > 0) {
      findings.push({ type: 'generic_secret', action: EGRESS_ACTIONS.BLOCK, path, count: 1 });
      blocked = true;
      output = '[REDACTED:SECRET]';
    }
    for (const [type, rule] of Object.entries(rules)) {
      for (const pattern of rule.patterns || []) {
        pattern.lastIndex = 0;
        if (!pattern.test(output)) continue;
        pattern.lastIndex = 0;
        const matches = output.match(pattern) || [];
        const action = rule.action || EGRESS_ACTIONS.BLOCK;
        findings.push({ type, action, path, count: matches.length });
        if (action === EGRESS_ACTIONS.BLOCK) blocked = true;
        if (action === EGRESS_ACTIONS.REDACT || action === EGRESS_ACTIONS.BLOCK) {
          output = output.replace(pattern, rule.replacement || `[REDACTED:${type.toUpperCase()}]`);
        }
      }
    }
    return output;
  });
  const action = blocked ? EGRESS_ACTIONS.BLOCK : findings.length ? EGRESS_ACTIONS.REDACT : EGRESS_ACTIONS.ALLOW;
  return {
    action,
    allowed: action !== EGRESS_ACTIONS.BLOCK,
    blocked,
    value: transformed,
    findings,
    risk: action === EGRESS_ACTIONS.BLOCK ? 95 : action === EGRESS_ACTIONS.REDACT ? 70 : 0,
    reason: action === EGRESS_ACTIONS.BLOCK ? 'Sensitive data egress blocked' : action === EGRESS_ACTIONS.REDACT ? 'Sensitive data redacted before egress' : 'No sensitive data detected'
  };
}

export function createEgressGuard(options = {}) {
  const config = { ...options };
  return {
    inspect(value) { return inspectEgress(value, config); },
    guard(value) { return guardEgress(value, config); },
    rules: normalizeRules(config.rules)
  };
}
