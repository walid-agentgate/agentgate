import test from 'node:test';
import assert from 'node:assert/strict';
import { getPolicyPack, listPolicyPacks } from '../src/policy-packs.js';
import { simulatePolicyMatrix } from '../src/local-experience.js';
import { analyzeShadowEvents, recordShadowEvent } from '../src/shadow-mode.js';

test('support refund safety pack has explicit boundaries', () => {
  const pack = getPolicyPack('support-refund-safety');
  assert.equal(pack.version, '1.0.0');
  const results = simulatePolicyMatrix({ policies: pack.policies, cases: pack.cases });
  assert.deepEqual(results.map(x => x.decision), ['ASK', 'ASK', 'ASK', 'BLOCK', 'BLOCK', 'BLOCK']);
  assert.deepEqual(results.map(x => x.decision), pack.cases.map(x => x.expected));
});

test('policy packs are discoverable and defensive copies', () => {
  const list = listPolicyPacks();
  assert.equal(list.length, 3);
  assert.equal(list[0].id, 'support-refund-safety');
  const a = getPolicyPack('support-refund-safety');
  const b = getPolicyPack('support-refund-safety');
  a.policies.blockActions.push('delete');
  assert.deepEqual(b.policies.blockActions, ['export_all']);
});


test('all design partner policy packs pass their declared cases', () => {
  for (const id of ['support-refund-safety', 'production-devops-safety', 'customer-data-export-safety']) {
    const pack = getPolicyPack(id);
    const results = simulatePolicyMatrix({ policies: pack.policies, cases: pack.cases });
    assert.deepEqual(results.map(x => x.decision), pack.cases.map(x => x.expected));
  }
});

test('shadow mode detects would-block executions', () => {
  const safe = recordShadowEvent({ decision: 'ASK', executed: true, request: { action: 'refund' } });
  const unsafe = recordShadowEvent({ decision: 'BLOCK', executed: true, request: { action: 'delete' } });
  const report = analyzeShadowEvents([safe, unsafe]);
  assert.equal(report.total, 2);
  assert.equal(report.wouldBlockExecuted, 1);
  assert.equal(report.wouldAskExecuted, 1);
  assert.equal(report.safeForEnforcement, false);
});
