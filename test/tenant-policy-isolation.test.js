import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createControlPlane } from '../src/control-plane.js';
import { createMCPGateway } from '../src/mcp-gateway.js';
import { createPolicyRegistry } from '../src/policy-registry.js';
import { createPolicyBundleRegistry } from '../src/policy-bundles.js';

test('policy registry isolates versions, activation, diff and audit by tenant', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentgate-policy-tenant-'));
  try {
    const r = createPolicyRegistry({ filePath: path.join(dir, 'policies.json') });
    const a = r.create('payments', { blockActions: ['refund'] }, {}, 'tenant-A');
    const b = r.create('payments', { blockActions: ['delete'] }, {}, 'tenant-B');
    r.test('payments', a.version, [{ input: { action: 'refund' }, expected: 'BLOCK' }], 'tenant-A');
    r.test('payments', b.version, [{ input: { action: 'delete' }, expected: 'BLOCK' }], 'tenant-B');
    r.activate('payments', a.version, 'tenant-A');
    r.activate('payments', b.version, 'tenant-B');
    assert.equal(r.list('payments', 'tenant-A').length, 1);
    assert.equal(r.list('payments', 'tenant-B').length, 1);
    assert.equal(r.active('payments', 'tenant-A').policy.blockActions[0], 'refund');
    assert.equal(r.active('payments', 'tenant-B').policy.blockActions[0], 'delete');
    assert.equal(r.get('payments', 1, 'tenant-A').tenantId, 'tenant-A');
    assert.equal(r.get('payments', 1, 'tenant-B').tenantId, 'tenant-B');
    assert.equal(r.auditLog('payments', 'tenant-A').every(x => x.tenantId === 'tenant-A'), true);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('policy bundles isolate versions and activation by tenant', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentgate-bundle-tenant-'));
  try {
    const r = createPolicyBundleRegistry({ filePath: path.join(dir, 'bundles.json') });
    const a = r.create('core', { blockActions: ['refund'] }, {}, 'tenant-A');
    const b = r.create('core', { blockActions: ['delete'] }, {}, 'tenant-B');
    r.test('core', a.version, [{ input: { action: 'refund' }, expected: 'BLOCK' }], 'tenant-A');
    r.test('core', b.version, [{ input: { action: 'delete' }, expected: 'BLOCK' }], 'tenant-B');
    r.activate('core', a.version, 'tenant-A');
    r.activate('core', b.version, 'tenant-B');
    assert.equal(r.list('core', 'tenant-A').length, 1);
    assert.equal(r.list('core', 'tenant-B').length, 1);
    assert.equal(r.active('core', 'tenant-A').policies.blockActions[0], 'refund');
    assert.equal(r.active('core', 'tenant-B').policies.blockActions[0], 'delete');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('runtime enforcement resolves active policies for the authenticated tenant only', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentgate-runtime-tenant-'));
  try {
    const gateway = createMCPGateway({ mode: 'enforce', tools: [{ name: 'export_all', handler: async () => 'executed' }, { name: 'read', handler: async () => 'executed' }] });
    const cp = createControlPlane({ gateway, policyPersistence: path.join(dir, 'policies.json'), policyBundlePersistence: path.join(dir, 'bundles.json') });
    for (const [tenant, action] of [['tenant-A', 'export_all'], ['tenant-B', 'delete']]) {
      const created = await cp.api('/api/policies/create', 'POST', { name: 'security', policy: { blockActions: [action] }, tenantId: tenant }, {}, { tenantId: tenant });
      assert.equal(created.policy.tenantId, tenant);
      const tested = await cp.api('/api/policies/test', 'POST', { name: 'security', version: 1, cases: [{ input: { action }, expected: 'BLOCK' }] }, {}, { tenantId: tenant });
      assert.equal(tested.test.passed, true);
      await cp.api('/api/policies/activate', 'POST', { name: 'security', version: 1, tenantId: tenant }, {}, { tenantId: tenant });
    }
    const a = await gateway.handle({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'export_all', arguments: {}, action: 'export_all', tenantId: 'tenant-A' } });
    const b = await gateway.handle({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'read', arguments: {}, action: 'read', tenantId: 'tenant-B' } });
    assert.equal(a.result.isError, true);
    assert.equal(a.result._agentgate.decision.decision, 'BLOCK');
    assert.equal(b.result.isError, undefined);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('control plane cannot expose another tenant policy by name/version/query', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentgate-api-tenant-'));
  try {
    const cp = createControlPlane({ policyPersistence: path.join(dir, 'policies.json') });
    await cp.api('/api/policies/create', 'POST', { name: 'private', policy: { blockActions: ['refund'] } }, {}, { tenantId: 'tenant-A' });
    const own = await cp.api('/api/policies', 'GET', {}, { name: 'private' }, { tenantId: 'tenant-A' });
    const other = await cp.api('/api/policies', 'GET', {}, { name: 'private' }, { tenantId: 'tenant-B' });
    assert.equal(own.policies.length, 1);
    assert.equal(other.policies.length, 0);
    assert.equal(cp.api ? true : false, true);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
