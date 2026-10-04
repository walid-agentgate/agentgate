import test from 'node:test';
import assert from 'node:assert/strict';
import { createMCPGateway } from '../src/mcp-gateway.js';
import { runDeepAttackLab, summarizeAttackResults, DEEP_ATTACK_CASES } from '../src/attack-lab.js';

// The deep attack set specifically targets action names the policy engine
// doesn't classify by default, plus two "name evasion" cases (calling a
// dangerous action under a name that isn't in blockActions/approvalActions).
// New projects default to approval for these actions; strict production
// configurations can block them outright.

const deepTools = DEEP_ATTACK_CASES.map(c => ({ name: c.action, handler: async () => ({ executed: true }) }));

test('deep attack set requires approval for unrecognized actions under default policy', async () => {
  const gateway = createMCPGateway({ mode: 'enforce', policies: { productionBlock: true }, tools: deepTools });
  const results = await runDeepAttackLab(gateway);
  const summary = summarizeAttackResults(results);
  assert.equal(summary.total, DEEP_ATTACK_CASES.length);
  assert.equal(summary.allowed, 0, 'the default policy must not silently allow unrecognized actions');
  assert.equal(summary.failed, 0);
  assert.equal(summary.status, 'PROTECTED');
});

test('unknownActionPolicy: "ask" closes the gap the deep attack set finds', async () => {
  const gateway = createMCPGateway({
    mode: 'enforce',
    policies: { productionBlock: true, approvalAmount: 5000, unknownActionPolicy: 'ask' },
    tools: deepTools
  });
  const results = await runDeepAttackLab(gateway);
  const summary = summarizeAttackResults(results);
  assert.equal(summary.failed, 0, 'every deep-set case should be BLOCKed or ASKed once unknownActionPolicy is set');
  assert.equal(summary.allowed, 0);
  assert.equal(summary.status, 'PROTECTED');
});

test('name-evasion cases (calling a blocked action under a different name) are caught by unknownActionPolicy', async () => {
  const gateway = createMCPGateway({
    mode: 'enforce',
    policies: { blockActions: ['export_all'], approvalActions: ['delete'], unknownActionPolicy: 'block' },
    tools: [
      { name: 'export_data', handler: async () => ({ executed: true }) },
      { name: 'remove_customer', handler: async () => ({ executed: true }) }
    ]
  });
  const evasionCases = DEEP_ATTACK_CASES.filter(c => c.id.endsWith('-evasion'));
  const results = await runDeepAttackLab(gateway, { cases: evasionCases });
  assert.ok(results.every(r => r.decision === 'BLOCK'), 'aliased dangerous actions must not evade the block just by using a different name');
});

test('the base 5-case attack lab is unaffected by the new deep set', async () => {
  const { runGatewayAttackLab, ATTACK_CASES } = await import('../src/attack-lab.js');
  const gateway = createMCPGateway({
    mode: 'enforce',
    policies: { productionBlock: true },
    tools: ['export_all', 'update_production', 'delete', 'refund', 'publish'].map(name => ({ name, handler: async () => ({}) }))
  });
  const results = await runGatewayAttackLab(gateway);
  assert.equal(results.length, 5);
  assert.equal(ATTACK_CASES.length, 5);
  assert.equal(summarizeAttackResults(results).failed, 0);
});
