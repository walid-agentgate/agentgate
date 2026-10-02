import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PersistentCollectionStore } from '../src/persistent-store.js';
import { createMCPGateway } from '../src/mcp-gateway.js';
import { createControlPlane } from '../src/control-plane.js';

// Follow-up from the 2.14.0 verification report: a real disk-full test (in
// an isolated 256 KiB tmpfs) confirmed save() surfaces ENOSPC loudly instead
// of swallowing it — good — but flagged two open questions: does
// GET /api/ready reflect the failure, and does recovery after space frees
// up happen automatically? It also implicitly raises a sharper risk: save()
// throwing *inside* an HTTP request handler, uncaught, can take the whole
// control-plane process down over a single write failure. These tests use a
// read-only directory as a portable stand-in for "the write fails" (same
// fs.writeFileSync exception family as ENOSPC) to check all three.

function tmpDir() { return fs.mkdtempSync(path.join(os.tmpdir(), 'agentgate-writefail-')); }

async function startServer(cp) {
  const server = cp.server.listen(0);
  await new Promise(resolve => server.once('listening', resolve));
  return { server, port: server.address().port };
}

test('a write failure is recorded on lastWriteError, still throws, and clears itself on the next successful save', () => {
  const dir = tmpDir();
  const store = new PersistentCollectionStore(path.join(dir, 'runs.json'));
  assert.equal(store.lastWriteError, null);

  const originalWriteFileSync = fs.writeFileSync;
  fs.writeFileSync = () => { const err = new Error('ENOSPC: no space left on device, write'); err.code = 'ENOSPC'; throw err; };
  try {
    assert.throws(() => store.add({ id: 'run_1' }), /ENOSPC/);
  } finally {
    fs.writeFileSync = originalWriteFileSync;
  }
  assert.ok(store.lastWriteError, 'the failure must be recorded for observability');
  assert.equal(store.lastWriteError.code, 'ENOSPC');

  // Space "frees up" — the next save() succeeds and clears the record automatically.
  store.add({ id: 'run_2' });
  assert.equal(store.lastWriteError, null, 'a later successful save must clear the earlier failure with no manual reset');
});

test('gateway.persistenceHealth() reports degraded while a write is failing, and recovers automatically', async () => {
  const dir = tmpDir();
  const gateway = createMCPGateway({ persistence: dir, tools: [{ name: 'refund', handler: async () => ({ ok: true }) }] });
  assert.equal(gateway.persistenceHealth().degraded, false);

  const originalWriteFileSync = fs.writeFileSync;
  fs.writeFileSync = () => { const err = new Error('EACCES: permission denied, open'); err.code = 'EACCES'; throw err; };
  try {
    await assert.rejects(
      () => gateway.handle({
        jsonrpc: '2.0', id: 1, method: 'tools/call',
        params: { name: 'refund', arguments: { amount: 10 }, action: 'refund' }
      }),
      /EACCES/,
      'the write failure must still propagate (fail loud), not be swallowed'
    );
  } finally {
    fs.writeFileSync = originalWriteFileSync;
  }
  const degradedHealth = gateway.persistenceHealth();
  assert.equal(degradedHealth.degraded, true);
  assert.ok(degradedHealth.writeErrors.length > 0);
  assert.equal(degradedHealth.writeErrors[0].code, 'EACCES');

  // Recovery: a normal call after the "disk" is writable again clears it.
  await gateway.handle({
    jsonrpc: '2.0', id: 2, method: 'tools/call',
    params: { name: 'refund', arguments: { amount: 10 }, action: 'refund' }
  });
  assert.equal(gateway.persistenceHealth().degraded, false, 'health must recover automatically once writes succeed again');
});

test('a write failure inside an HTTP request handler returns 500 instead of crashing the control-plane process', async () => {
  const dir = tmpDir();
  const gateway = createMCPGateway({ persistence: dir, tools: [{ name: 'refund', handler: async () => ({ ok: true }) }] });
  const cp = createControlPlane({ gateway, persistence: dir, authRequired: false });
  const { server, port } = await startServer(cp);

  const created = await gateway.handle({
    jsonrpc: '2.0', id: 1, method: 'tools/call',
    params: { name: 'refund', arguments: { amount: 900 }, action: 'refund' }
  });
  const approvalId = created.result._agentgate.approvalId;

  const originalWriteFileSync = fs.writeFileSync;
  fs.writeFileSync = () => { const err = new Error('ENOSPC: no space left on device, write'); err.code = 'ENOSPC'; throw err; };
  let res;
  try {
    res = await fetch(`http://127.0.0.1:${port}/api/approvals/approve`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ approvalId })
    });
  } finally {
    fs.writeFileSync = originalWriteFileSync;
  }
  assert.equal(res.status, 500, 'a write failure must answer the request with 500, not hang or kill the process');
  const json = await res.json();
  assert.match(json.message, /ENOSPC/);

  // The process (and this server) must still be alive and serving normally
  // for the next, unrelated request — one failed write must not take down
  // every other in-flight or future request.
  const health = await fetch(`http://127.0.0.1:${port}/api/health`);
  assert.equal(health.status, 200);

  server.close();
});

test('GET /api/ready reflects a write failure as degraded/503, and recovers once writes succeed again', async () => {
  const dir = tmpDir();
  const gateway = createMCPGateway({ persistence: dir, tools: [{ name: 'refund', handler: async () => ({ ok: true }) }] });
  const cp = createControlPlane({ gateway, persistence: dir, authRequired: false });
  const { server, port } = await startServer(cp);

  const okBefore = await fetch(`http://127.0.0.1:${port}/api/ready`);
  assert.equal(okBefore.status, 200);
  assert.equal((await okBefore.json()).persistence.degraded, false);

  const originalWriteFileSync = fs.writeFileSync;
  fs.writeFileSync = () => { const err = new Error('ENOSPC: no space left on device, write'); err.code = 'ENOSPC'; throw err; };
  try {
    // Trigger a write directly on the gateway's run store (the 500 from the
    // HTTP path itself is covered by the previous test; here we only need
    // the failure recorded before checking /api/ready).
    await gateway.handle({
      jsonrpc: '2.0', id: 1, method: 'tools/call',
      params: { name: 'refund', arguments: { amount: 10 }, action: 'refund' }
    });
  } catch { /* expected: write fails while fs.writeFileSync is stubbed */ }
  finally {
    fs.writeFileSync = originalWriteFileSync;
  }

  const duringFailure = await fetch(`http://127.0.0.1:${port}/api/ready`);
  assert.equal(duringFailure.status, 503);
  const duringJson = await duringFailure.json();
  assert.equal(duringJson.ready, false);
  assert.equal(duringJson.persistence.degraded, true);

  // Space "frees up": the next successful write clears the degraded state,
  // and /api/ready reports healthy again with no restart needed.
  await gateway.handle({
    jsonrpc: '2.0', id: 3, method: 'tools/call',
    params: { name: 'refund', arguments: { amount: 10 }, action: 'refund' }
  });
  const afterRecovery = await fetch(`http://127.0.0.1:${port}/api/ready`);
  assert.equal(afterRecovery.status, 200);
  assert.equal((await afterRecovery.json()).persistence.degraded, false);

  server.close();
});
