export class RuntimeTelemetry {
  constructor() {
    this.startedAt = Date.now();
    this.counters = new Map();
    this.latency = new Map();
  }
  increment(name, value = 1) { this.counters.set(name, (this.counters.get(name) || 0) + value); }
  observe(name, milliseconds) { const item = this.latency.get(name) || { count: 0, totalMs: 0, maxMs: 0 }; item.count += 1; item.totalMs += Number(milliseconds) || 0; item.maxMs = Math.max(item.maxMs, Number(milliseconds) || 0); this.latency.set(name, item); }
  snapshot() {
    const counters = Object.fromEntries(this.counters);
    const latency = Object.fromEntries([...this.latency].map(([k,v]) => [k, {...v, avgMs: v.count ? Number((v.totalMs / v.count).toFixed(3)) : 0}]));
    return { uptimeSeconds: Math.floor((Date.now() - this.startedAt) / 1000), counters, latency, timestamp: new Date().toISOString() };
  }
}
export const createTelemetry = () => new RuntimeTelemetry();

export class SlidingWindowLimiter {
  constructor({ limit = 120, windowMs = 60_000 } = {}) { this.limit = limit; this.windowMs = windowMs; this.buckets = new Map(); }
  check(key = 'global') {
    const now = Date.now();
    const bucket = (this.buckets.get(key) || []).filter(t => now - t < this.windowMs);
    const allowed = bucket.length < this.limit;
    if (allowed) bucket.push(now);
    this.buckets.set(key, bucket);
    return { allowed, limit: this.limit, remaining: Math.max(0, this.limit - bucket.length), resetAt: new Date((bucket[0] || now) + this.windowMs).toISOString() };
  }
  clear(key) { if (key) this.buckets.delete(key); else this.buckets.clear(); }
}
