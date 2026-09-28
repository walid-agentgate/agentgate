import fs from 'node:fs';
import path from 'node:path';

export class PersistentCollectionStore {
  constructor(filePath, { key = 'id', limit = 25000, seed = [] } = {}) {
    this.filePath = path.resolve(filePath);
    this.key = key;
    this.limit = limit;
    this.items = this.#load(seed);
  }

  add(item) {
    this.items.unshift(item);
    this.#trim();
    this.save();
    return item;
  }
  get(id) { return this.items.find(item => item?.[this.key] === id) || null; }
  list(filter) {
    const values = [...this.items];
    if (typeof filter === 'function') return values.filter(filter);
    return values;
  }
  update(id, patch) {
    const item = this.get(id);
    if (!item) return null;
    Object.assign(item, patch);
    this.save();
    return item;
  }
  replace(items) { this.items = Array.isArray(items) ? items.slice(0, this.limit) : []; this.save(); return this.list(); }
  save() {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    const temp = `${this.filePath}.tmp`;
    fs.writeFileSync(temp, JSON.stringify(this.items, null, 2), 'utf8');
    fs.renameSync(temp, this.filePath);
  }
  #load(seed) {
    try {
      if (!fs.existsSync(this.filePath)) return Array.isArray(seed) ? seed.slice(0, this.limit) : [];
      const parsed = JSON.parse(fs.readFileSync(this.filePath, 'utf8'));
      return Array.isArray(parsed) ? parsed.slice(0, this.limit) : [];
    } catch { return Array.isArray(seed) ? seed.slice(0, this.limit) : []; }
  }
  #trim() { if (this.items.length > this.limit) this.items.splice(this.limit); }
}

export function createPersistentRunStore(options = {}) {
  return new PersistentCollectionStore(options.filePath || '.agentgate/runs.json', { limit: options.limit || 25000 });
}
export function createPersistentApprovalStore(options = {}) {
  return new PersistentCollectionStore(options.filePath || '.agentgate/approvals.json', { limit: options.limit || 25000 });
}
export function createPersistentAgentStore(options = {}) {
  return new PersistentCollectionStore(options.filePath || '.agentgate/agents.json', { limit: options.limit || 1000 });
}
