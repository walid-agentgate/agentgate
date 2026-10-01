import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createMCPGateway } from '../src/mcp-gateway.js';
import { createControlPlane } from '../src/control-plane.js';

// A "restart" is simulated by dropping the in-memory gateway reference and
// creating a brand new one pointed at the same persistence directory — the
// same thing that happens when the Node process running `agentgate dev` (or
// a real deployment) is stopped and started again.

function tmpDir() { return fs.mkdtempSync(path.join(os.tmpdir(), 'agentgate-restart-')); }

test('a pending approval survives a restart and can still be approved', async () => {
  const dir = tmpDir();
  const tools = [{ name: 'refund', handler: async (input) => ({ refunded: input.amount }) }];

  const before = createMCPGateway({ persistence: dir, tools });
  const created = await before.handle({
    jsonrpc: '2.0', id: 1, method: 'tools/call',
    params: { name: 'refund', arguments: { amount: 750 }, action: 'refund' }
  });
  const approvalId = created.result._agentgate.approvalId;
  assert.equal(before.getApproval(approvalId).status, 'pending');

  // --- restart: new gateway instance, same persistence dir, tool re-registered ---
  const after = createMCPGateway({ persistence: dir, tools });
  assert.equal(after.getApproval(approvalId).status, 'pending', 'the approval itself must have survived the restart');

  const resolved = await after.approve(approvalId);
  assert.equal(resolved.ok, true);
  assert.equal(resolved.status, 'executed');
  assert.deepEqual(resolved.value, { refunded: 750 });

  // --- a second restart should see the resolution, not a stale pending state ---
  const afterAgain = createMCPGateway({ persistence: dir, tools });
  assert.equal(afterAgain.getApproval(approvalId).status, 'approved');
});

test('a denial and its reason survive a restart', async () => {
  const dir = tmpDir();
  const tools = [{ name: 'delete', handler: async () => ({ ok: true }) }];
  const before = createMCPGateway({ persistence: dir, tools });
  const created = await before.handle({
    jsonrpc: '2.0', id: 2, method: 'tools/call',
    params: { name: 'delete', arguments: { id: 'x' }, action: 'delete' }
  });
  const approvalId = created.result._agentgate.approvalId;
  await before.deny(approvalId, 'Needs manager sign-off');

  const after = createMCPGateway({ persistence: dir, tools });
  const approval = after.getApproval(approvalId);
  assert.equal(approval.status, 'denied');
  assert.equal(approval.resolutionReason, 'Needs manager sign-off');
  // A denied approval must stay denied — a late approve() must not resurrect it.
  const lateApprove = await after.approve(approvalId);
  assert.equal(lateApprove.ok, false);
});

test('TTL expiry is honored even if the whole process was down past the deadline', async () => {
  const dir = tmpDir();
  const tools = [{ name: 'refund', handler: async () => ({ ok: true }) }];
  const before = createMCPGateway({ persistence: dir, approvalTTLMs: 30, tools });
  const created = await before.handle({
    jsonrpc: '2.0', id: 3, method: 'tools/call',
    params: { name: 'refund', arguments: { amount: 200 }, action: 'refund' }
  });
  const approvalId = created.result._agentgate.approvalId;

  // Simulate the process being down for longer than the TTL (no timers can
  // fire while the process doesn't exist — expiry must be computed lazily
  // from the stored `expiresAt`, not from a live setTimeout).
  await new Promise(resolve => setTimeout(resolve, 60));
  const after = createMCPGateway({ persistence: dir, approvalTTLMs: 30, tools });

  assert.equal(after.getApproval(approvalId).status, 'expired');
  const lateApprove = await after.approve(approvalId);
  assert.equal(lateApprove.ok, false);
  assert.match(lateApprove.error, /expired/i);
});

test('run history and audit export are consistent across a restart', async () => {
  const dir = tmpDir();
  const tools = [{ name: 'read', handler: async () => ({ data: 'ok' }) }];
  const before = createMCPGateway({ persistence: dir, tools });
  await before.handle({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'read', arguments: {}, action: 'read' } });
  assert.equal(before.runs().length, 1);

  const after = createMCPGateway({ persistence: dir, tools });
  assert.equal(after.runs().length, 1, 'run history must not be lost on restart');

  const cp = createControlPlane({ gateway: after, persistence: dir, authRequired: false });
  const exported = await cp.api('/api/audit/export', 'GET', {}, {});
  assert.equal(exported.runs.length, 1);
});
