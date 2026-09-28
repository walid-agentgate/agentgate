import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createControlPlane } from '../src/control-plane.js';
import { createMCPGateway } from '../src/mcp-gateway.js';

test('control plane exposes live runs and approvals', async () => {
  const gateway = createMCPGateway({ tools: [{ name: 'refund', handler: async () => 'ok' }] });
  const cp = createControlPlane({ gateway });
  const result = await gateway.handle({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'refund', arguments: { amount: 900 }, action: 'refund' } });
  const runs = await cp.api('/api/runs');
  const approvals = await cp.api('/api/approvals', 'GET', { status: 'pending' });
  assert.equal(runs.runs.length, 1);
  assert.equal(approvals.approvals[0].id, result.result._agentgate.approvalId);
});

test('control plane resolves approvals', async () => {
  const gateway = createMCPGateway({ tools: [{ name: 'refund', handler: async () => 'ok' }] });
  const cp = createControlPlane({ gateway });
  const result = await gateway.handle({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'refund', arguments: { amount: 900 }, action: 'refund' } });
  const resolved = await cp.api('/api/approvals/approve', 'POST', { approvalId: result.result._agentgate.approvalId });
  assert.equal(resolved.status, 'executed');
});

test('control plane exposes behavior and blast radius analysis', async () => {
  const gateway = createMCPGateway({ mode:'enforce', policies:{ productionBlock:true }, tools:[
    { name:'read', handler: async () => ({ ok:true }) },
    { name:'delete', handler: async () => ({ ok:true }) }
  ]});
  await gateway.handle({ jsonrpc:'2.0', id:1, method:'tools/call', params:{ name:'read', arguments:{}, agent:'DemoAgent' }});
  await gateway.handle({ jsonrpc:'2.0', id:2, method:'tools/call', params:{ name:'delete', arguments:{}, agent:'DemoAgent' }});
  const { createControlPlane } = await import('../src/control-plane.js');
  const cp = createControlPlane({ gateway });
  const behavior = await cp.api('/api/behavior');
  const blast = await cp.api('/api/blast-radius');
  assert.ok(behavior.runsAnalyzed >= 2);
  assert.equal(blast.runCount, 2);
});

test('control plane manages policy versions and syncs active policy to gateway', async () => {
  const gateway = createMCPGateway({ mode: 'enforce', policies: { productionBlock: true } });
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentgate-cp-policy-'));
  const { api } = createControlPlane({ gateway, policyPersistence: path.join(tmpDir, 'policies.json') });
  const created = await api('/api/policies/create', 'POST', { name: 'payments', policy: { blockActions: ['refund'] } });
  assert.equal(created.policy.version, 1);
  const tested = await api('/api/policies/test', 'POST', { name: 'payments', version: 1, cases: [{ input: { action: 'refund' }, expected: 'BLOCK' }] });
  assert.equal(tested.test.passed, true);
  const activated = await api('/api/policies/activate', 'POST', { name: 'payments', version: 1 });
  assert.equal(activated.policy.state, 'active');
  assert.deepEqual(gateway.policies.blockActions, ['refund']);
  const diff = await api('/api/policies/diff', 'GET', {}, { name: 'payments', from: '1', to: '1' });
  assert.deepEqual(diff.diff.changes, []);
});
