import test from 'node:test';
import assert from 'node:assert/strict';
import { createMCPGateway } from '../src/mcp-gateway.js';

test('ASK creates a pending approval without executing the tool', async () => {
  let called = false;
  const gateway = createMCPGateway({ tools: [{ name: 'refund', handler: async (args) => { called = args; return 'refunded'; } }] });
  const result = await gateway.handle({ jsonrpc: '2.0', id: 10, method: 'tools/call', params: { name: 'refund', arguments: { amount: 1000, customer: 'c1' }, action: 'refund' } });
  assert.equal(result.result._agentgate.approvalRequired, true);
  assert.equal(called, false);
  const approval = gateway.getApproval(result.result._agentgate.approvalId);
  assert.equal(approval.status, 'pending');
  assert.equal(approval.metadata.arguments.amount, 1000);
});

test('approval executes the original tool only after approve', async () => {
  let args;
  const gateway = createMCPGateway({ tools: [{ name: 'refund', handler: async (input) => { args = input; return { ok: true }; } }] });
  const result = await gateway.handle({ jsonrpc: '2.0', id: 11, method: 'tools/call', params: { name: 'refund', arguments: { amount: 1200 }, action: 'refund' } });
  const approvalId = result.result._agentgate.approvalId;
  const approved = await gateway.approve(approvalId);
  assert.equal(approved.status, 'executed');
  assert.deepEqual(args, { amount: 1200 });
  assert.equal(gateway.replay(approved.run.id).status, 'executed');
  assert.equal(gateway.getApproval(approvalId).status, 'approved');
});

test('deny prevents execution and is auditable', async () => {
  let called = false;
  const gateway = createMCPGateway({ tools: [{ name: 'delete', handler: async () => { called = true; } }] });
  const result = await gateway.handle({ jsonrpc: '2.0', id: 12, method: 'tools/call', params: { name: 'delete', arguments: { id: 'x' }, action: 'delete' } });
  const denied = await gateway.deny(result.result._agentgate.approvalId, 'Not authorized for this request');
  assert.equal(denied.status, 'denied');
  assert.equal(called, false);
  assert.equal(denied.run.status, 'denied');
  assert.equal(denied.approval.resolutionReason, 'Not authorized for this request');
});

test('approval cannot be resolved twice', async () => {
  const gateway = createMCPGateway({ tools: [{ name: 'refund', handler: async () => 'ok' }] });
  const result = await gateway.handle({ jsonrpc: '2.0', id: 13, method: 'tools/call', params: { name: 'refund', arguments: { amount: 900 }, action: 'refund' } });
  const id = result.result._agentgate.approvalId;
  const first = await gateway.approve(id);
  const second = await gateway.deny(id);
  assert.equal(first.status, 'executed');
  assert.equal(second.ok, false);
});

test('approval endpoints work through JSON-RPC', async () => {
  const gateway = createMCPGateway({ tools: [{ name: 'refund', handler: async () => 'ok' }] });
  const result = await gateway.handle({ jsonrpc: '2.0', id: 14, method: 'tools/call', params: { name: 'refund', arguments: { amount: 900 }, action: 'refund' } });
  const approvalId = result.result._agentgate.approvalId;
  const list = await gateway.handle({ jsonrpc: '2.0', id: 15, method: 'agentgate/approvals/list', params: { status: 'pending' } });
  assert.equal(list.result.approvals[0].id, approvalId);
  const deny = await gateway.handle({ jsonrpc: '2.0', id: 16, method: 'agentgate/approvals/deny', params: { approvalId, reason: 'manual denial' } });
  assert.equal(deny.result.status, 'denied');
});
