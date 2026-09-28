import { TenantRegistry } from './multi-tenant.js';

export const AUTH_HEADERS = Object.freeze({ apiKey: 'x-agentgate-key', authorization: 'authorization' });

export function extractAPIKey(headers = {}) {
  const direct = headers[AUTH_HEADERS.apiKey] || headers['X-AgentGate-Key'];
  if (direct) return String(direct).trim();
  const auth = headers[AUTH_HEADERS.authorization] || headers['Authorization'];
  if (!auth) return null;
  const match = String(auth).match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : null;
}

export function createAuthMiddleware(options = {}) {
  const registry = options.registry || new TenantRegistry(options);
  const publicPaths = new Set(options.publicPaths || ['/api/health']);
  return function authenticate(req, path, scope) {
    if (publicPaths.has(path)) return { ok: true, public: true };
    const secret = extractAPIKey(req.headers || {});
    const auth = registry.authenticate(secret);
    if (!auth) return { ok: false, status: 401, error: 'Unauthorized' };
    const tenantId = req.headers['x-agentgate-tenant'] || req.headers['X-AgentGate-Tenant'];
    if (tenantId && tenantId !== auth.tenantId) return { ok: false, status: 403, error: 'Tenant mismatch' };
    if (scope && !registry.authorize(auth, auth.tenantId, scope)) return { ok: false, status: 403, error: 'Insufficient scope' };
    return { ok: true, auth, tenantId: auth.tenantId };
  };
}
