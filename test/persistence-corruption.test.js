import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PersistentCollectionStore, PersistenceCorruptionError, createPersistentRunStore, createPersistentApprovalStore } from '../src/persistent-store.js';
import { createMCPGateway } from '../src/mcp-gateway.js';
import { createControlPlane } from '../src/control-plane.js';

// Repro from the 2.13.14 stress-test report: writing `THIS IS NOT JSON` into
// runs.json (or `{bad` into approvals.json) and restarting silently produced
// an empty collection — pending approvals and audit history vanished with no
// error, no alert, nothing. This locks in the fix: corruption fails closed
// by default, and is only "recovered" (quarantined + reset) when the caller
// explicitly opts in.

function tmpDir() { return fs.mkdtempSync(path.join(os.tmpdir(), 'agentgate-corrupt-')); }

test('a missing file is normal — starts with seed/empty, no error', () => {
  const dir = tmpDir();
  const store = new PersistentCollectionStore(path.join(dir, 'runs.json'));
  assert.deepEqual(store.list(), []);
  assert.equal(store.corruption, null);
});

test('invalid JSON fails closed by default instead of silently becoming []', () => {
  const dir = tmpDir();
  const file = path.join(dir, 'runs.json');
  fs.writeFileSync(file, 'THIS IS NOT JSON', 'utf8');
  assert.throws(
    () => new PersistentCollectionStore(file),
    (err) => err instanceof PersistenceCorruptionError && err.code === 'AGENTGATE_PERSISTENCE_CORRUPT'
  );
});

test('valid JSON that is not an array also fails closed', () => {
  const dir = tmpDir();
  const file = path.join(dir, 'approvals.json');
  fs.writeFileSync(file, JSON.stringify({ not: 'an array' }), 'utf8');
  assert.throws(
    () => new PersistentCollectionStore(file),
    (err) => err instanceof PersistenceCorruptionError
  );
});

test('corrupted approvals.json fails closed at gateway startup — pending approvals are never silently dropped', () => {
  const dir = tmpDir();
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'approvals.json'), '{bad', 'utf8');
  assert.throws(() => createMCPGateway({ persistence: dir, tools: [{ name: 'refund', handler: async () => 'ok' }] }));
});

test('corrupted runs.json fails closed at gateway startup', () => {
  const dir = tmpDir();
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'runs.json'), 'THIS IS NOT JSON', 'utf8');
  assert.throws(() => createMCPGateway({ persistence: dir, tools: [{ name: 'refund', handler: async () => 'ok' }] }));
});

test('recoverFromCorruption: true quarantines the bad file and reports degraded health instead of hiding it', () => {
  const dir = tmpDir();
  const file = path.join(dir, 'runs.json');
  fs.writeFileSync(file, 'THIS IS NOT JSON', 'utf8');

  const store = new PersistentCollectionStore(file, { recoverFromCorruption: true });
  assert.deepEqual(store.list(), []);
  assert.ok(store.corruption, 'corruption should be recorded, not silently absorbed');
  assert.ok(fs.existsSync(store.corruption.quarantinePath), 'the original corrupt file must be preserved for investigation');
  assert.equal(fs.existsSync(file), false, 'the corrupt file should no longer sit at the live path');
  assert.equal(fs.readFileSync(store.corruption.quarantinePath, 'utf8'), 'THIS IS NOT JSON');
});

test('gateway.persistenceHealth() reports degraded after a recovered corruption, healthy otherwise', () => {
  const healthyDir = tmpDir();
  const healthyGateway = createMCPGateway({ persistence: healthyDir, tools: [{ name: 'refund', handler: async () => 'ok' }] });
  assert.deepEqual(healthyGateway.persistenceHealth(), { persistent: true, degraded: false, corruptions: [] });

  const corruptDir = tmpDir();
  fs.mkdirSync(corruptDir, { recursive: true });
  fs.writeFileSync(path.join(corruptDir, 'approvals.json'), '{bad', 'utf8');
  const recoveredGateway = createMCPGateway({
    persistence: corruptDir,
    recoverFromCorruption: true,
    tools: [{ name: 'refund', handler: async () => 'ok' }]
  });
  const health = recoveredGateway.persistenceHealth();
  assert.equal(health.degraded, true);
  assert.equal(health.corruptions.length, 1);
});

test('/api/ready returns 503 and degraded=true when persistence was recovered from corruption', async () => {
  const dir = tmpDir();
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'runs.json'), 'THIS IS NOT JSON', 'utf8');
  const gateway = createMCPGateway({
    persistence: dir,
    recoverFromCorruption: true,
    tools: [{ name: 'refund', handler: async () => 'ok' }]
  });
  const cp = createControlPlane({ gateway, persistence: dir, authRequired: false });
  const server = cp.server.listen(0);
  await new Promise(resolve => server.once('listening', resolve));
  const port = server.address().port;
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/ready`);
    const json = await res.json();
    assert.equal(res.status, 503);
    assert.equal(json.ready, false);
    assert.equal(json.persistence.degraded, true);
  } finally {
    server.close();
  }
});

test('createPersistentRunStore / createPersistentApprovalStore propagate recoverFromCorruption', () => {
  const dir = tmpDir();
  fs.writeFileSync(path.join(dir, 'runs.json'), 'nope', 'utf8');
  fs.writeFileSync(path.join(dir, 'approvals.json'), 'nope', 'utf8');
  assert.throws(() => createPersistentRunStore({ filePath: path.join(dir, 'runs.json') }));
  assert.throws(() => createPersistentApprovalStore({ filePath: path.join(dir, 'approvals.json') }));
  const recoveredRuns = createPersistentRunStore({ filePath: path.join(dir, 'runs.json'), recoverFromCorruption: true });
  const recoveredApprovals = createPersistentApprovalStore({ filePath: path.join(dir, 'approvals.json'), recoverFromCorruption: true });
  assert.deepEqual(recoveredRuns.list(), []);
  assert.deepEqual(recoveredApprovals.list(), []);
  assert.ok(recoveredRuns.corruption);
  assert.ok(recoveredApprovals.corruption);
});
