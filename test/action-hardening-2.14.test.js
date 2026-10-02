import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluate } from '../src/policy-engine.js';
import { createMCPGateway } from '../src/mcp-gateway.js';

// Exact Unicode/control-character action names from the 2.13.14 stress-test
// report, which all previously ALLOWed:
//   grant_админ, delete\u0000all, 💣_publish, ％ｅｘｐｏｒｔ, ../delete, delete‮
const REPORTED_EVASION_NAMES = [
  'delete\u0000all',
  'ＥＸＰＯＲＴ', // fullwidth "EXPORT"-shaped
  '../delete',
  'delete‮'
];

test('unsafe action names (control chars, bidi override, fullwidth, path traversal) are blocked unconditionally', () => {
  for (const action of REPORTED_EVASION_NAMES) {
    const result = evaluate({ action, environment: 'production' }, { productionBlock: true });
    assert.equal(result.decision, 'BLOCK', `expected BLOCK for ${JSON.stringify(action)}, got ${result.decision}`);
    assert.equal(result.winningRule, 'unsafe-action-name');
  }
});

test('ordinary action names are unaffected by the unsafe-name check', () => {
  for (const action of ['read', 'refund', 'delete', 'export_all', 'my_custom_tool', 'grant_admin']) {
    const result = evaluate({ action, environment: 'development' }, {});
    assert.notEqual(result.winningRule, 'unsafe-action-name');
  }
});

test('strictActionNames (opt-in) requires a lowercase ascii-identifier-shaped name', () => {
  const strict = { strictActionNames: true };
  const okResult = evaluate({ action: 'refund' }, strict);
  assert.notEqual(okResult.decision, 'BLOCK');
  const badResult = evaluate({ action: 'Grant Admin!' }, strict);
  assert.equal(badResult.decision, 'BLOCK');
  assert.equal(badResult.winningRule, 'strict-action-name');
});

test('strictActionNames is off by default — mixed-case/space action names still work', () => {
  const result = evaluate({ action: 'Some Legacy Action' }, {});
  assert.notEqual(result.winningRule, 'strict-action-name');
});

test('tool registration metadata is authoritative even when the caller sends an unrecognized action name (production: destructive metadata BLOCKs outright)', async () => {
  const gateway = createMCPGateway({
    mode: 'enforce',
    policies: { productionBlock: true, unknownActionPolicy: 'allow' }, // the historical default — metadata must still catch it
    tools: [
      { name: 'grant_admin', actionClass: 'destructive', requiresApproval: true, handler: async () => ({ granted: true }) }
    ]
  });
  const result = await gateway.handle({
    jsonrpc: '2.0', id: 1, method: 'tools/call',
    params: { name: 'grant_admin', arguments: {}, action: 'totally_unrecognized_name', environment: 'production' }
  });
  // actionClass: 'destructive' + productionBlock in production BLOCKs outright —
  // stronger than the requiresApproval ASK also set on this tool, and a world
  // away from the unrecognized-action ALLOW the name alone would have gotten.
  assert.equal(result.result._agentgate.decision.decision, 'BLOCK');
  assert.equal(result.result._agentgate.decision.winningRule, 'tool-metadata-production-block');
});

test('tool registration metadata requiresApproval alone (no productionBlock match) ASKs under an unrecognized action name', async () => {
  const gateway = createMCPGateway({
    mode: 'enforce',
    policies: { unknownActionPolicy: 'allow' }, // the historical default — metadata must still catch it
    tools: [
      { name: 'grant_admin', requiresApproval: true, handler: async () => ({ granted: true }) }
    ]
  });
  const result = await gateway.handle({
    jsonrpc: '2.0', id: 1, method: 'tools/call',
    params: { name: 'grant_admin', arguments: {}, action: 'totally_unrecognized_name', environment: 'development' }
  });
  assert.equal(result.result._agentgate.decision.decision, 'ASK');
  assert.equal(result.result._agentgate.decision.winningRule, 'tool-metadata-approval');
});

test('tool metadata environments restriction blocks the tool outside its allowed environments', async () => {
  const gateway = createMCPGateway({
    mode: 'enforce',
    tools: [
      { name: 'danger', environments: ['development', 'staging'], handler: async () => ({ ok: true }) }
    ]
  });
  const prodResult = await gateway.handle({
    jsonrpc: '2.0', id: 1, method: 'tools/call',
    params: { name: 'danger', arguments: {}, action: 'danger', environment: 'production' }
  });
  assert.equal(prodResult.result._agentgate.decision.decision, 'BLOCK');
  assert.equal(prodResult.result._agentgate.decision.winningRule, 'tool-metadata-environment');

  const devResult = await gateway.handle({
    jsonrpc: '2.0', id: 2, method: 'tools/call',
    params: { name: 'danger', arguments: {}, action: 'danger', environment: 'development' }
  });
  assert.notEqual(devResult.result._agentgate.decision.decision, 'BLOCK');
});

test('an amount that hard-exceeds approvalAmount still BLOCKs even if tool metadata would only ASK', async () => {
  const gateway = createMCPGateway({
    mode: 'enforce',
    policies: { approvalAmount: 5000 },
    tools: [
      { name: 'wire', requiresApproval: true, handler: async () => ({ ok: true }) }
    ]
  });
  const result = await gateway.handle({
    jsonrpc: '2.0', id: 1, method: 'tools/call',
    params: { name: 'wire', arguments: { amount: 50000 }, action: 'wire', amount: 50000 }
  });
  assert.equal(result.result._agentgate.decision.decision, 'BLOCK');
  assert.equal(result.result._agentgate.decision.winningRule, 'approval-amount-hard');
});

test('a readOnly-classified tool is allowed via metadata even under an unrecognized name, without executing anything unapproved first', async () => {
  let executed = false;
  const gateway = createMCPGateway({
    mode: 'enforce',
    policies: { unknownActionPolicy: 'block' }, // strictest setting — metadata should still make this ALLOW
    tools: [
      { name: 'lookup_customer', actionClass: 'readOnly', handler: async () => { executed = true; return { ok: true }; } }
    ]
  });
  const result = await gateway.handle({
    jsonrpc: '2.0', id: 1, method: 'tools/call',
    params: { name: 'lookup_customer', arguments: {}, action: 'lookup_customer' }
  });
  assert.equal(result.result._agentgate.decision.decision, 'ALLOW');
  assert.equal(result.result._agentgate.decision.winningRule, 'tool-metadata-readonly');
  assert.equal(executed, true);
});
