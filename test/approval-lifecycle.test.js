import test from 'node:test';
import assert from 'node:assert/strict';
import { createMCPGateway } from '../src/mcp-gateway.js';
import { DEFAULT_APPROVAL_TTL_MS } from '../src/approval.js';

// These cover the exact questions a reviewer asked about the approval
// lifecycle: exactly-once execution under a race, expiry, and defaults.
// (The interactive CLI — `agentgate approval list/approve/deny` — is a thin
// HTTP client over the same runtime methods exercised here, so correctness
// at this layer covers the CLI too.)

test('default approval TTL is 15 minutes', () => {
  assert.equal(DEFAULT_APPROVAL_TTL_MS, 15 * 60 * 1000);
});

test('concurrent approve() calls on the same approval execute the tool exactly once', async () => {
  let executions = 0;
  const gateway = createMCPGateway({
    tools: [{ name: 'refund', handler: async (input) => { executions += 1; return { refunded: input.amount }; } }]
  });
  const result = await gateway.handle({
    jsonrpc: '2.0', id: 1, method: 'tools/call',
    params: { name: 'refund', arguments: { amount: 1200 }, action: 'refund' }
  });
  const approvalId = result.result._agentgate.approvalId;

  // Two callers racing to resolve the same approval at once — simulates a
  // double-click, a retried HTTP request, or two operators approving the
  // same request from different tabs.
  const [first, second] = await Promise.all([
    gateway.approve(approvalId),
    gateway.approve(approvalId)
  ]);
  const outcomes = [first, second];
  const succeeded = outcomes.filter(o => o.ok && o.status === 'executed');
  const rejected = outcomes.filter(o => !o.ok || o.status !== 'executed');

  assert.equal(executions, 1, 'the underlying tool must run exactly once');
  assert.equal(succeeded.length, 1, 'exactly one of the two racing approve() calls should succeed');
  assert.equal(rejected.length, 1, 'the losing call must be rejected, not silently ignored');
  assert.match(rejected[0].error, /already/i);
});

test('concurrent approve() and deny() on the same approval resolve exactly one way', async () => {
  let executed = false;
  const gateway = createMCPGateway({
    tools: [{ name: 'delete', handler: async () => { executed = true; return { ok: true }; } }]
  });
  const result = await gateway.handle({
    jsonrpc: '2.0', id: 2, method: 'tools/call',
    params: { name: 'delete', arguments: { id: 'x' }, action: 'delete' }
  });
  const approvalId = result.result._agentgate.approvalId;

  const [approved, denied] = await Promise.all([
    gateway.approve(approvalId),
    gateway.deny(approvalId, 'racing denial')
  ]);
  // Exactly one of the two must have taken effect — never both, never neither.
  const winners = [approved, denied].filter(o => o.ok !== false);
  assert.equal(winners.length, 1);
  if (approved.ok !== false) assert.equal(executed, true);
  else assert.equal(executed, false);
});

test('a pending approval expires on its own after its TTL and can no longer be actioned', async () => {
  const gateway = createMCPGateway({
    approvalTTLMs: 20,
    tools: [{ name: 'refund', handler: async () => ({ ok: true }) }]
  });
  const result = await gateway.handle({
    jsonrpc: '2.0', id: 3, method: 'tools/call',
    params: { name: 'refund', arguments: { amount: 500 }, action: 'refund' }
  });
  const approvalId = result.result._agentgate.approvalId;
  assert.equal(gateway.getApproval(approvalId).status, 'pending');

  await new Promise(resolve => setTimeout(resolve, 40));

  assert.equal(gateway.getApproval(approvalId).status, 'expired');
  const late = await gateway.approve(approvalId);
  assert.equal(late.ok, false);
  assert.match(late.error, /expired/i);

  const expiredList = gateway.approvals('expired');
  assert.ok(expiredList.some(a => a.id === approvalId));
});

test('ttlMs: null disables expiry for a request that must stay open indefinitely', async () => {
  const gateway = createMCPGateway({
    approvalTTLMs: null,
    tools: [{ name: 'refund', handler: async () => ({ ok: true }) }]
  });
  const result = await gateway.handle({
    jsonrpc: '2.0', id: 4, method: 'tools/call',
    params: { name: 'refund', arguments: { amount: 500 }, action: 'refund' }
  });
  const approvalId = result.result._agentgate.approvalId;
  await new Promise(resolve => setTimeout(resolve, 30));
  assert.equal(gateway.getApproval(approvalId).status, 'pending');
  const resolved = await gateway.approve(approvalId);
  assert.equal(resolved.ok, true);
});
