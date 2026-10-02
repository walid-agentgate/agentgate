import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createMCPGateway } from '../src/mcp-gateway.js';
import { createControlPlane } from '../src/control-plane.js';

function tmpDir() { return fs.mkdtempSync(path.join(os.tmpdir(), 'agentgate-idempotency-')); }

async function startServer(cp) {
  const server = cp.server.listen(0);
  await new Promise(resolve => server.once('listening', resolve));
  return { server, port: server.address().port };
}

test('a retried POST /api/approvals/approve with the same Idempotency-Key does not execute twice', async () => {
  const dir = tmpDir();
  let executions = 0;
  const gateway = createMCPGateway({ persistence: dir, tools: [{ name: 'refund', handler: async () => { executions++; return { ok: true }; } }] });
  const cp = createControlPlane({ gateway, persistence: dir, authRequired: false });
  const { server, port } = await startServer(cp);

  const created = await gateway.handle({
    jsonrpc: '2.0', id: 1, method: 'tools/call',
    params: { name: 'refund', arguments: { amount: 900 }, action: 'refund' }
  });
  const approvalId = created.result._agentgate.approvalId;

  const key = 'approval_123:resolve:v1';
  const first = await fetch(`http://127.0.0.1:${port}/api/approvals/approve`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'idempotency-key': key },
    body: JSON.stringify({ approvalId })
  });
  const firstJson = await first.json();
  assert.equal(firstJson.ok, true);
  assert.equal(firstJson.status, 'executed');
  assert.equal(executions, 1);

  // Retry with the exact same key: must get back the exact same response,
  // not a second execution and not an "already approved" error either.
  const second = await fetch(`http://127.0.0.1:${port}/api/approvals/approve`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'idempotency-key': key },
    body: JSON.stringify({ approvalId })
  });
  const secondJson = await second.json();
  assert.equal(second.headers.get('idempotency-replayed'), 'true');
  assert.deepEqual(secondJson, firstJson);
  assert.equal(executions, 1, 'the handler must not run a second time on a replayed idempotency key');

  server.close();
});

test('a different Idempotency-Key against the same approval is rejected normally (already approved), not replayed', async () => {
  const dir = tmpDir();
  const gateway = createMCPGateway({ persistence: dir, tools: [{ name: 'refund', handler: async () => ({ ok: true }) }] });
  const cp = createControlPlane({ gateway, persistence: dir, authRequired: false });
  const { server, port } = await startServer(cp);

  const created = await gateway.handle({
    jsonrpc: '2.0', id: 1, method: 'tools/call',
    params: { name: 'refund', arguments: { amount: 900 }, action: 'refund' }
  });
  const approvalId = created.result._agentgate.approvalId;

  await fetch(`http://127.0.0.1:${port}/api/approvals/approve`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'idempotency-key': 'key-a' },
    body: JSON.stringify({ approvalId })
  });

  const retryWithDifferentKey = await fetch(`http://127.0.0.1:${port}/api/approvals/approve`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'idempotency-key': 'key-b' },
    body: JSON.stringify({ approvalId })
  });
  const json = await retryWithDifferentKey.json();
  assert.notEqual(json.ok, true);
  assert.equal(retryWithDifferentKey.headers.get('idempotency-replayed'), null);

  server.close();
});

test('requests with no Idempotency-Key header behave exactly as before (no caching)', async () => {
  const dir = tmpDir();
  const gateway = createMCPGateway({ persistence: dir, tools: [{ name: 'refund', handler: async () => ({ ok: true }) }] });
  const cp = createControlPlane({ gateway, persistence: dir, authRequired: false });
  const { server, port } = await startServer(cp);

  const created = await gateway.handle({
    jsonrpc: '2.0', id: 1, method: 'tools/call',
    params: { name: 'refund', arguments: { amount: 900 }, action: 'refund' }
  });
  const approvalId = created.result._agentgate.approvalId;

  const res = await fetch(`http://127.0.0.1:${port}/api/approvals/approve`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ approvalId })
  });
  assert.equal(res.headers.get('idempotency-replayed'), null);
  const json = await res.json();
  assert.equal(json.ok, true);

  server.close();
});
