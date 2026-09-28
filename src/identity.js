export const AUTH_DECISIONS = Object.freeze({ ALLOW: 'ALLOW', BLOCK: 'BLOCK' });

function arr(value) {
  if (value == null) return [];
  return Array.isArray(value) ? value.map(String) : [String(value)];
}

function matches(value, expected) {
  const actual = String(value ?? '');
  return arr(expected).some(pattern => {
    if (pattern === '*') return true;
    if (!pattern.includes('*')) return actual === pattern;
    const escaped = pattern.split('*').map(s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*');
    return new RegExp(`^${escaped}$`).test(actual);
  });
}

function listMatches(actual, expected) {
  const values = arr(actual);
  return !expected || arr(expected).length === 0 || values.some(v => matches(v, expected));
}

function attributesMatch(actual = {}, expected = {}) {
  return Object.entries(expected || {}).every(([key, wanted]) => {
    const value = actual?.[key];
    if (Array.isArray(wanted)) return wanted.map(String).includes(String(value));
    return matches(value, wanted);
  });
}

function ruleMatches(request, rule = {}) {
  const identity = request.identity || {};
  if (rule.actions && !matches(request.action, rule.actions)) return false;
  if (rule.tools && !matches(request.tool, rule.tools)) return false;
  if (rule.resources && !matches(request.resource, rule.resources)) return false;
  if (rule.agents && !matches(identity.agentId || identity.agent || request.agent, rule.agents)) return false;
  if (rule.users && !matches(identity.userId || identity.user, rule.users)) return false;
  if (rule.roles && !listMatches(identity.roles || identity.role, rule.roles)) return false;
  if (rule.environments && !matches(request.environment, rule.environments)) return false;
  if (rule.attributes && !attributesMatch(identity.attributes || {}, rule.attributes)) return false;
  return true;
}

export function normalizeIdentity(input = {}) {
  const identity = input.identity && typeof input.identity === 'object' ? input.identity : {};
  const agent = identity.agentId || identity.agent || input.agent || null;
  const user = identity.userId || identity.user || input.userId || input.user || null;
  return {
    agentId: agent,
    userId: user,
    roles: arr(identity.roles || identity.role || input.roles || input.role),
    attributes: { ...(input.attributes || {}), ...(identity.attributes || {}) },
    authenticated: identity.authenticated !== false && Boolean(agent || user || (identity.roles || input.roles || identity.role || input.role)),
    source: identity.source || input.identitySource || 'runtime'
  };
}

export function authorize(request = {}, authorization = {}) {
  if (!authorization || Object.keys(authorization).length === 0) {
    return { decision: AUTH_DECISIONS.ALLOW, reason: 'Authorization layer not configured', matchedRule: null, identity: normalizeIdentity(request), enforced: false };
  }

  const identity = normalizeIdentity(request);
  const base = { decision: AUTH_DECISIONS.BLOCK, identity, enforced: true, matchedRule: null };

  if (authorization.requireIdentity !== false && !identity.authenticated) {
    return { ...base, reason: 'Authenticated identity is required' };
  }

  const rules = Array.isArray(authorization.rules) ? authorization.rules : [];
  for (const rule of rules) {
    if (!ruleMatches({ ...request, identity }, rule)) continue;
    const effect = String(rule.effect || 'deny').toLowerCase();
    if (effect === 'allow') return { ...base, decision: AUTH_DECISIONS.ALLOW, reason: rule.reason || 'Authorization rule allowed request', matchedRule: rule.id || null };
    return { ...base, reason: rule.reason || 'Authorization rule denied request', matchedRule: rule.id || null };
  }

  const roles = authorization.roles || {};
  for (const role of identity.roles) {
    const rolePolicy = roles[role];
    if (!rolePolicy) continue;
    if (rolePolicy.deny && (matches(request.action, rolePolicy.deny.actions) || matches(request.tool, rolePolicy.deny.tools) || matches(request.resource, rolePolicy.deny.resources))) {
      return { ...base, reason: `Role ${role} explicitly denies this action`, matchedRule: `role:${role}:deny` };
    }
    if (rolePolicy.allow && (matches(request.action, rolePolicy.allow.actions) || matches(request.tool, rolePolicy.allow.tools) || matches(request.resource, rolePolicy.allow.resources))) {
      return { ...base, decision: AUTH_DECISIONS.ALLOW, reason: `Role ${role} allows this action`, matchedRule: `role:${role}:allow` };
    }
  }

  if (authorization.defaultEffect === 'allow') {
    return { ...base, decision: AUTH_DECISIONS.ALLOW, reason: 'Authorization default effect allows request', matchedRule: 'default' };
  }
  return { ...base, reason: 'No authorization rule matched; deny by default' };
}

export function createIdentityRegistry(options = {}) {
  const items = options.store || new Map();
  function register(identity = {}) {
    const normalized = normalizeIdentity(identity);
    const id = normalized.agentId || normalized.userId;
    if (!id) throw new TypeError('registerIdentity() requires agentId or userId');
    const record = { ...normalized, id, updatedAt: new Date().toISOString(), createdAt: items.get(id)?.createdAt || new Date().toISOString() };
    if (items instanceof Map) items.set(id, record); else items.add(record);
    return record;
  }
  function get(id) { return items instanceof Map ? items.get(id) || null : items.get(id); }
  function list() { return items instanceof Map ? [...items.values()] : items.list(); }
  return Object.freeze({ register, get, list });
}
