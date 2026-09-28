import test from 'node:test';
import assert from 'node:assert/strict';
import { generatePolicySuggestions, mergePolicies } from '../src/policy-builder.js';

test('generates deterministic block and approval suggestions from attacks', () => {
  const result = generatePolicySuggestions([
    { action: 'export_all', decision: 'BLOCK', reason: 'Sensitive export' },
    { action: 'refund', decision: 'ASK', reason: 'Approval required' },
    { action: 'delete', decision: 'ALLOW', risk: 80 }
  ]);

  assert.deepEqual(result.policy.blockActions, ['export_all']);
  assert.deepEqual(result.policy.approvalActions, ['delete', 'refund']);
  assert.equal(result.suggestions.length, 3);
});

test('blocked actions are never left in approvalActions', () => {
  const result = mergePolicies(
    { blockActions: ['delete'], approvalActions: ['refund'] },
    { blockActions: ['export_all'], approvalActions: ['delete', 'refund'] }
  );

  assert.deepEqual(result.blockActions, ['delete', 'export_all']);
  assert.deepEqual(result.approvalActions, ['refund']);
});
