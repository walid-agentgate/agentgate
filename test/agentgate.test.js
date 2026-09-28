import test from 'node:test';
import assert from 'node:assert/strict';
import { createAgentGate } from '../src/agentgate.js';

test('agentgate protect allows read-only tools', async () => {
  const gate = createAgentGate({ agent: 'SupportBot', mode: 'enforce' });
  const readCustomer = gate.protect(async input => ({ id: input.id }), { tool: 'read_customer', action: 'read' });
  const result = await readCustomer({ id: 'cus_1' });
  assert.equal(result.status, 'executed');
  assert.equal(result.value.id, 'cus_1');
  assert.equal(result.agentgate.decision, 'ALLOW');
});

test('agentgate protect blocks dangerous production actions', async () => {
  const gate = createAgentGate({ agent: 'OpsBot', mode: 'enforce', policies: { productionBlock: true } });
  let called = false;
  const deleteProd = gate.protect(async () => { called = true; }, { tool: 'delete', action: 'delete' });
  await assert.rejects(() => deleteProd({ id: 'prod_1' }), error => {
    assert.equal(error.code, 'AGENTGATE_BLOCKED');
    assert.equal(error.agentgate.decision, 'BLOCK');
    return true;
  });
  assert.equal(called, false);
});

test('agentgate protect requires approval for sensitive actions', async () => {
  const gate = createAgentGate({ agent: 'BillingBot', mode: 'enforce' });
  const refund = gate.protect(async input => ({ refunded: input.amount }), { tool: 'refund', action: 'refund' });
  const result = await refund({ amount: 900 });
  assert.equal(result.status, 'approval_required');
  assert.equal(result.agentgate.decision, 'ASK');
});

test('agentgate observe mode executes while recording simulated decisions', async () => {
  const gate = createAgentGate({ agent: 'OpsBot', mode: 'observe', policies: { productionBlock: true } });
  const deleteProd = gate.protect(async input => ({ deleted: input.id }), { tool: 'delete', action: 'delete' });
  const result = await deleteProd({ id: 'prod_2' });
  assert.equal(result.status, 'executed');
  assert.equal(result.agentgate.decision, 'BLOCK');
  assert.equal(result.agentgate.simulated, true);
});


test('agentgate runtime persists winningRule and ruleTrace', async () => {
  const gate = createAgentGate({ agent: 'BillingBot', mode: 'enforce', policies: { approvalAmount: 5000 } });
  const refund = gate.protect(async input => ({ refunded: input.amount }), { tool: 'refund', action: 'refund' });
  await assert.rejects(() => refund({ amount: 9000 }, { amount: 9000 }), error => {
    assert.equal(error.agentgate.winningRule, 'approval-amount-hard');
    assert.equal(error.agentgate.ruleTrace.at(-1).id, 'approval-amount-hard');
    return true;
  });
  const run = gate.runs()[0];
  assert.equal(run.winningRule, 'approval-amount-hard');
  assert.deepEqual(run.ruleTrace, run.ruleTrace);
});


test('agentgate exposes approval lifecycle for protected SDK tools', async () => {
  const gate = createAgentGate({ agent: 'BillingBot', mode: 'enforce' });
  let calls = 0;
  const refund = gate.protect(async input => { calls += 1; return { refunded: input.amount }; }, { tool: 'refund', action: 'refund' });
  const result = await refund({ amount: 900 });
  assert.equal(result.status, 'approval_required');
  assert.ok(result.approvalId);
  assert.equal(gate.approvals('pending').length, 1);
  assert.equal(calls, 0);
  const approved = await gate.approve(result.approvalId);
  assert.equal(approved.status, 'executed');
  assert.equal(calls, 1);
  assert.equal(gate.getApproval(result.approvalId).status, 'approved');
  const second = await gate.deny(result.approvalId, 'too late');
  assert.equal(second.ok, false);
});

test('agentgate denial never executes a protected tool', async () => {
  const gate = createAgentGate({ agent: 'BillingBot', mode: 'enforce' });
  let calls = 0;
  const refund = gate.protect(async () => { calls += 1; return 'refunded'; }, { tool: 'refund', action: 'refund' });
  const result = await refund({ amount: 900 });
  const denied = await gate.deny(result.approvalId, 'not authorized');
  assert.equal(denied.status, 'denied');
  assert.equal(calls, 0);
});
