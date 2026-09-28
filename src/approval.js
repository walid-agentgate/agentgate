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

export function createApprovalRequest(data = {}, store = new ApprovalStore()) {
  return store.add({
    id: data.id || `approval_${randomUUID()}`,
    createdAt: new Date().toISOString(),
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

function clone(value) { try { return structuredClone(value); } catch { return JSON.parse(JSON.stringify(value)); } }
