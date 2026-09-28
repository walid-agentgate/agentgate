import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPolicyBundleRegistry } from '../src/policy-bundles.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('v2.2 launch package includes developer docs and deployment assets', () => {
  for (const file of ['LICENSE','SECURITY.md','CONTRIBUTING.md','CHANGELOG.md','Dockerfile','docs/quickstart.md','examples/refund-agent.mjs','examples/policy-bundle.mjs']) {
    assert.equal(fs.existsSync(path.join(root,file)), true, file);
  }
  const pkg = JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8'));
  assert.equal(pkg.version, '2.13.8');
  assert.ok(pkg.files.includes('docs'));
});

test('v2.2 quickstart policy bundle example is executable', () => {
  const file = path.join(root, '.agentgate-test-bundle.json');
  try {
    const registry = createPolicyBundleRegistry({filePath:file});
    const created = registry.create('launch-test', { productionBlock:true, approvalActions:['delete'] });
    const tested = registry.test('launch-test', created.version, [
      { input:{action:'read',environment:'production'}, expected:'ALLOW' },
      { input:{action:'delete',environment:'production'}, expected:'BLOCK' }
    ]);
    assert.equal(tested.passed, true);
    assert.equal(registry.activate('launch-test', created.version).state, 'active');
  } finally {
    try { fs.unlinkSync(file); } catch {}
  }
});
