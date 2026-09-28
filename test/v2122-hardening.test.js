import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluate } from '../src/policy-engine.js';
import { createMCPGateway } from '../src/mcp-gateway.js';

test('hard approval amount wins over approvalActions', () => {
  const policies = { approvalActions: ['refund'], autoApproveAmount: 100, approvalAmount: 5000 };
  assert.equal(evaluate({ action: 'refund', amount: 5000 }, policies).decision, 'ASK');
  assert.equal(evaluate({ action: 'refund', amount: 5000.01 }, policies).decision, 'BLOCK');
  assert.equal(evaluate({ action: 'refund', amount: 9000 }, policies).decision, 'BLOCK');
});

test('invalid amount types fail closed', () => {
  const policies = { approvalActions: ['refund'], autoApproveAmount: 100, approvalAmount: 5000 };
  for (const amount of ['5000.01', [5000.01], { value: 5000.01 }, true, Infinity, -1]) {
    const result = evaluate({ action: 'refund', amount }, policies);
    assert.equal(result.decision, 'BLOCK');
    assert.equal(result.winningRule, 'invalid-amount');
  }
});

test('MCP run persists winningRule and ruleTrace', async () => {
  const gateway = createMCPGateway({
    tools: [{ name: 'refund', handler: async () => { throw new Error('must not execute'); } }],
    policies: { approvalActions: ['refund'], autoApproveAmount: 100, approvalAmount: 5000 },
    tenantId: 't1'
  });
  const response = await gateway.handle({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'refund', arguments: { amount: 9000 } } });
  assert.equal(response.result._agentgate.decision.decision, 'BLOCK');
  const run = gateway.replay(response.result._agentgate.runId);
  assert.equal(run.winningRule, 'approval-amount-hard');
  assert.ok(Array.isArray(run.ruleTrace));
  assert.ok(run.ruleTrace.some((r) => r.id === 'approval-amount-hard'));
});
