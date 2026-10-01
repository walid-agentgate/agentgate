import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createMCPGateway } from '../src/mcp-gateway.js';
import { createControlPlane } from '../src/control-plane.js';

// Repro from the 2.13.14 stress-test report: an oversized POST body followed
// by an unrelated request (even one with a completely different, fake API
// key) on the same keep-alive connection used to hang for ~10s instead of
// returning 401 quickly. Root cause: the server stopped reading the first
// request's body as soon as it exceeded maxBodySize, without draining the
// rest of what the client was still sending — those leftover bytes then
// confused the HTTP parser's read of the "next" request on the same socket.

function tmpDir() { return fs.mkdtempSync(path.join(os.tmpdir(), 'agentgate-oversized-')); }

async function startServer(cp) {
  const server = cp.server.listen(0);
  await new Promise(resolve => server.once('listening', resolve));
  return { server, port: server.address().port };
}

test('an oversized request does not delay the next request on the same connection', async () => {
  const dir = tmpDir();
  const gateway = createMCPGateway({ persistence: dir, tools: [{ name: 'refund', handler: async () => 'ok' }] });
  const cp = createControlPlane({ gateway, persistence: dir, authRequired: true, maxBodySize: 1024 });
  const { server, port } = await startServer(cp);

  try {
    const oversizedBody = JSON.stringify({ padding: 'x'.repeat(5000) });
    const oversizedRes = await fetch(`http://127.0.0.1:${port}/api/approvals`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-agentgate-key': 'fake-key-1' },
      body: oversizedBody
    });
    assert.equal(oversizedRes.status, 413);
    await oversizedRes.json().catch(() => null);

    const start = Date.now();
    const followUp = await fetch(`http://127.0.0.1:${port}/api/approvals`, {
      method: 'GET',
      headers: { 'x-agentgate-key': 'fake-key-2' }
    });
    const elapsed = Date.now() - start;
    assert.equal(followUp.status, 401, 'the follow-up request must fail auth quickly, not hang');
    assert.ok(elapsed < 2000, `follow-up request took ${elapsed}ms — it should fail fast, not time out`);
  } finally {
    server.close();
  }
});

test('repeated oversized-then-normal-request sequences never time out (x10)', async () => {
  const dir = tmpDir();
  const gateway = createMCPGateway({ persistence: dir, tools: [{ name: 'refund', handler: async () => 'ok' }] });
  const cp = createControlPlane({ gateway, persistence: dir, authRequired: true, maxBodySize: 1024, rateLimit: 10000 });
  const { server, port } = await startServer(cp);

  try {
    for (let i = 0; i < 10; i++) {
      const oversized = await fetch(`http://127.0.0.1:${port}/api/approvals`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-agentgate-key': `fake-${i}` },
        body: JSON.stringify({ padding: 'y'.repeat(5000) })
      });
      assert.equal(oversized.status, 413);
      await oversized.json().catch(() => null);

      const start = Date.now();
      const next = await fetch(`http://127.0.0.1:${port}/api/approvals`, {
        method: 'GET',
        headers: { 'x-agentgate-key': `fake-next-${i}` }
      });
      assert.equal(next.status, 401);
      assert.ok(Date.now() - start < 2000, `iteration ${i}: follow-up request should not hang`);
    }
  } finally {
    server.close();
  }
});
