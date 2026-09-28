import test from 'node:test';
import assert from 'node:assert/strict';
import { createEventBus, createPolicyBundleRegistry, BUNDLE_STATES, adminAuthorize, mapOIDCClaims, validateOIDCIdentity } from '../src/index.js';
import { mkdtempSync, rmSync } from 'node:fs'; import { tmpdir } from 'node:os'; import { join } from 'node:path';

test('v2.0 event bus publishes runtime events',()=>{const b=createEventBus();let got; b.subscribe('*',m=>got=m); const m=b.publish('run.decided',{decision:'BLOCK'}); assert.equal(got.event,'run.decided'); assert.equal(m.payload.decision,'BLOCK');});
test('v2.0 policy bundle tests and activates atomically',()=>{const d=mkdtempSync(join(tmpdir(),'ag20-')); try{const r=createPolicyBundleRegistry({filePath:join(d,'bundles.json')}); const b=r.create('payments',{approvalAmount:5000,autoApproveAmount:500}); const t=r.test('payments',b.version,[{input:{action:'refund',amount:1000,environment:'staging'},expected:'ASK'}]); assert.equal(t.passed,true); const a=r.activate('payments',b.version); assert.equal(a.state,BUNDLE_STATES.ACTIVE); }finally{rmSync(d,{recursive:true,force:true});}});
test('v2.0 admin RBAC is explicit',()=>{assert.equal(adminAuthorize({roles:['VIEWER']},'runs:read'),true);assert.equal(adminAuthorize({roles:['VIEWER']},'keys:write'),false);assert.equal(adminAuthorize({roles:['OWNER']},'anything'),true);});
test('v2.0 OIDC mapping is tenant-bound',()=>{const i=mapOIDCClaims({sub:'u1',tenant_id:'ten_1',roles:['ADMIN'],email:'a@example.com',iss:'issuer'});assert.equal(i.userId,'u1');assert.equal(validateOIDCIdentity(i,'ten_1'),true);assert.equal(validateOIDCIdentity(i,'ten_2'),false);});
