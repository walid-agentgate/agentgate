import fs from 'node:fs';
import path from 'node:path';

// Thrown when a persisted collection file exists but cannot be trusted:
// invalid JSON, or valid JSON that isn't the array shape this store expects.
// This is distinct from "file does not exist yet" (ENOENT), which is the
// normal first-run case and is NOT an error.
export class PersistenceCorruptionError extends Error {
  constructor(message, options) {
    super(message, options);
    this.name = 'PersistenceCorruptionError';
    this.code = 'AGENTGATE_PERSISTENCE_CORRUPT';
  }
}

export class PersistentCollectionStore {
  constructor(filePath, { key = 'id', limit = 25000, seed = [], recoverFromCorruption = false, onCorruption } = {}) {
    this.filePath = path.resolve(filePath);
    this.key = key;
    this.limit = limit;
    this.recoverFromCorruption = Boolean(recoverFromCorruption);
    this.onCorruption = typeof onCorruption === 'function' ? onCorruption : null;
    // Set only if a corruption event was handled (requires recoverFromCorruption:
    // true). When this is non-null, the in-memory collection was reset and
    // whatever was in the corrupt file was NOT recovered automatically.
    this.corruption = null;
    // Set when the most recent save() failed (disk full, permission denied,
    // I/O error, ...) and cleared the moment a save() succeeds again. save()
    // still throws on every failure — this never swallows the error — it's
    // purely so a health check (persistenceHealth() / GET /api/ready) can
    // see *and automatically stop reporting* a write failure without the
    // caller having to wire that up itself.
    this.lastWriteError = null;
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
    try {
      fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
      const temp = `${this.filePath}.tmp`;
      fs.writeFileSync(temp, JSON.stringify(this.items, null, 2), 'utf8');
      fs.renameSync(temp, this.filePath);
      this.lastWriteError = null; // a later successful save clears any earlier failure automatically
    } catch (err) {
      this.lastWriteError = { message: err.message, code: err.code || null, at: new Date().toISOString() };
      throw err; // still fails loudly — this record is for observability, not to mask the failure
    }
  }

  #load(seed) {
    let text;
    try {
      text = fs.readFileSync(this.filePath, 'utf8');
    } catch (err) {
      // No file yet is the normal first-run case. Any other read failure
      // (permission denied, I/O error, ...) is an operational failure, not
      // "no data yet" — let it fail closed by propagating the error instead
      // of silently returning an empty collection.
      if (err.code === 'ENOENT') return Array.isArray(seed) ? seed.slice(0, this.limit) : [];
      throw err;
    }
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch (err) {
      return this.#handleCorruption(text, new PersistenceCorruptionError(
        `Corrupt persistence file (invalid JSON): ${this.filePath}`,
        { cause: err }
      ), seed);
    }
    if (!Array.isArray(parsed)) {
      return this.#handleCorruption(text, new PersistenceCorruptionError(
        `Corrupt persistence file (expected an array, got ${parsed === null ? 'null' : typeof parsed}): ${this.filePath}`
      ), seed);
    }
    return parsed.slice(0, this.limit);
  }

  // Corruption means the file exists but its contents cannot be trusted —
  // tampering, a crash mid-write on an older version, disk corruption, etc.
  // The previous behavior here was to swallow the error and silently return
  // an empty array, which quietly erases audit history and, worse, makes
  // pending approvals vanish with no trace. We now fail closed by default:
  // the store refuses to come up at all, so the operator finds out at
  // startup instead of discovering a gap in the audit trail later.
  //
  // Recovery is opt-in only (recoverFromCorruption: true): the corrupt file
  // is quarantined (renamed, never deleted) and the collection starts from
  // `seed` (normally empty) — but this is explicitly NOT the same as
  // recovering the lost data, and is logged loudly as such.
  #handleCorruption(rawText, error, seed) {
    if (!this.recoverFromCorruption) throw error;
    const quarantinePath = `${this.filePath}.corrupt.${Date.now()}`;
    try {
      fs.renameSync(this.filePath, quarantinePath);
    } catch {
      try { fs.writeFileSync(quarantinePath, rawText ?? '', 'utf8'); } catch { /* best effort */ }
    }
    this.corruption = {
      filePath: this.filePath,
      quarantinePath,
      message: error.message,
      recoveredAt: new Date().toISOString(),
      recoveredCount: Array.isArray(seed) ? seed.length : 0
    };
    console.error(
      `\n🚨 AgentGate: persistence corruption recovered for ${this.filePath}\n` +
      `   Corrupt file quarantined to: ${quarantinePath}\n` +
      `   Started with ${this.corruption.recoveredCount} seed record(s) — the original contents were NOT recovered.\n` +
      `   Investigate the quarantined file before trusting this collection again.\n`
    );
    this.onCorruption?.(this.corruption);
    return Array.isArray(seed) ? seed.slice(0, this.limit) : [];
  }

  #trim() { if (this.items.length > this.limit) this.items.splice(this.limit); }
}

export function createPersistentRunStore(options = {}) {
  return new PersistentCollectionStore(options.filePath || '.agentgate/runs.json', {
    limit: options.limit || 25000,
    recoverFromCorruption: options.recoverFromCorruption,
    onCorruption: options.onCorruption
  });
}
export function createPersistentApprovalStore(options = {}) {
  return new PersistentCollectionStore(options.filePath || '.agentgate/approvals.json', {
    limit: options.limit || 25000,
    recoverFromCorruption: options.recoverFromCorruption,
    onCorruption: options.onCorruption
  });
}
export function createPersistentAgentStore(options = {}) {
  return new PersistentCollectionStore(options.filePath || '.agentgate/agents.json', {
    limit: options.limit || 1000,
    recoverFromCorruption: options.recoverFromCorruption,
    onCorruption: options.onCorruption
  });
}
