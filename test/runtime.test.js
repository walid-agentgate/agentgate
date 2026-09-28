import test from 'node:test';
import assert from 'node:assert/strict';
import { createRuntime, runAttackLab } from '../src/index.js';

test('runtime records and blocks', async () => {
  const rt = createRuntime({ policies: { productionBlock: true } });
  await assert.rejects(() => rt.execute(async () => 'oops', { action:'delete', environment:'production' }), /blocked/);
  assert.equal(rt.runs().length, 1);
  assert.equal(rt.runs()[0].decision, 'BLOCK');
});

test('observe mode records without blocking', async () => {
  const rt = createRuntime({ mode:'observe', policies: { productionBlock: true } });
  const out = await rt.execute(async () => 'executed', { action:'delete', environment:'production' });
  assert.equal(out.status, 'executed');
  assert.equal(out.agentgate.simulated, true);
});

test('attack lab detects risky scenarios', () => {
  const results = runAttackLab({ productionBlock: true });
  assert.equal(results.length, 5);
  assert.equal(results.filter(x => x.passed).length, 5);
});
