import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createPolicyRegistry, POLICY_STATES } from '../src/policy-registry.js';

test('policy registry versions, tests, activation and diff',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'agentgate-policy-'));
  const r=createPolicyRegistry({filePath:path.join(dir,'policies.json')});
  r.create('payments',{autoApproveAmount:500,approvalAmount:5000});
  r.test('payments',1,[{name:'small refund',input:{action:'refund',amount:400},expected:'ASK'}]);
  const v2=r.create('payments',{autoApproveAmount:1000,approvalAmount:5000,blockActions:['export_all']});
  assert.equal(v2.version,2);
  const t=r.test('payments',2,[{name:'small refund',input:{action:'refund',amount:400},expected:'ASK'},{name:'export',input:{action:'export_all'},expected:'BLOCK'}]);
  assert.equal(t.passed,true); assert.equal(r.get('payments',2).state,POLICY_STATES.TESTED);
  r.activate('payments',2); assert.equal(r.active('payments').version,2);
  const d=r.diff('payments',1,2); assert.ok(d.changes.some(x=>x.key==='autoApproveAmount'));
  r.rollback('payments',1);
  assert.equal(r.active('payments').version,1);
  assert.ok(r.auditLog('payments').length>=4);
});

test('cannot activate untested draft',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'agentgate-policy-'));
  const r=createPolicyRegistry({filePath:path.join(dir,'policies.json')}); r.create('x',{});
  assert.throws(()=>r.activate('x',1),/pass tests/);
});

test('list() with no name returns every policy, not an empty list — regression for the dashboard "draft created but list stays empty" bug', () => {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'agentgate-policy-'));
  const r=createPolicyRegistry({filePath:path.join(dir,'policies.json')});
  assert.deepEqual(r.list(), []);
  r.create('refund-safety',{refund:{max:5000}});
  r.create('export-guard',{export_all:{block:true}});
  const all=r.list();
  assert.equal(all.length,2);
  assert.ok(all.some(p=>p.name==='refund-safety'));
  assert.ok(all.some(p=>p.name==='export-guard'));
  // list(name) still filters to just that policy's versions, unaffected by the fix
  assert.equal(r.list('refund-safety').length,1);
});
