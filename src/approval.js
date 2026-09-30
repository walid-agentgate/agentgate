import { randomUUID } from 'node:crypto';

export const APPROVAL_STATUS = Object.freeze({ PENDING: 'pending', APPROVED: 'approved', DENIED: 'denied', EXPIRED: 'expired' });

export class ApprovalStore {
  constructor(limit = 500) { this.limit = limit; this.items = []; }
  add(item) { this.items.unshift(item); if (this.items.length > this.limit) this.items.pop(); return item; }
  get(id) { return this.items.find(item => item.id === id) || null; }
  list(status) { return status ? this.items.filter(item => item.status === status) : [...this.items]; }
  save() {}
}

export function createApprovalStore(options = {}) { return options.store || new ApprovalStore(options.limit || 500); }

// Default: a pending approval expires after 15 minutes if nobody acts on it.
// Pass ttlMs: null (or 0) to disable expiry for a given request.
export const DEFAULT_APPROVAL_TTL_MS = 15 * 60 * 1000;

export function createApprovalRequest(data = {}, store = new ApprovalStore()) {
  const createdAt = new Date();
  const ttlMs = data.ttlMs === undefined ? DEFAULT_APPROVAL_TTL_MS : data.ttlMs;
  const expiresAt = ttlMs ? new Date(createdAt.getTime() + ttlMs).toISOString() : null;
  return store.add({
    id: data.id || `approval_${randomUUID()}`,
    createdAt: createdAt.toISOString(),
    expiresAt,
    status: APPROVAL_STATUS.PENDING,
    runId: data.runId,
    tenantId: data.tenantId || data.request?.tenantId || null,
    request: clone(data.request || {}),
    decision: data.decision,
    risk: data.risk,
    reason: data.reason,
    metadata: clone(data.metadata || {})
  });
}

// A pending approval is expired once `expiresAt` has passed. Every approval
// is single-use by construction: approve()/deny() flip `status` away from
// PENDING synchronously (before any await), so a second call — concurrent
// or not — always sees a non-pending status and is rejected. There is no
// separate "already used" flag to track.
export function isApprovalExpired(approval, now = Date.now()) {
  return Boolean(approval?.expiresAt) && new Date(approval.expiresAt).getTime() <= now;
}

function clone(value) { try { return structuredClone(value); } catch { return JSON.parse(JSON.stringify(value)); } }
