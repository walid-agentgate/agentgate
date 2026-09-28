import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const pkg=JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8'));
test('release archive version consistency',()=>{
  assert.equal(pkg.version,'2.13.8');
  assert.equal(path.basename(root),'agentgate-v2.13.8');
  const names=fs.readdirSync(root).filter(x=>x.endsWith('.tgz'));
  assert.deepEqual(names,[]);
  const html=fs.readFileSync(path.join(root,'standalone.html'),'utf8');
  assert.doesNotMatch(html,/async\s+async\s+function\s+exportAudit/);
  assert.match(html,/async function exportAudit\(\)/);
});
