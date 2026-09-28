import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { OrganizationRegistry, UsageMeter, EntitlementService, BillingAdapter, createSaaSControl, PLANS } from '../src/saas.js';
import { createControlPlane } from '../src/control-plane.js';
import { createMCPGateway } from '../src/mcp-gateway.js';

function temp(){ return fs.mkdtempSync(path.join(os.tmpdir(),'agentgate-v23-')); }

test('v2.3 organization registry isolates members and supports plans', () => {
  const d=temp(); const r=new OrganizationRegistry({persistence:d});
  const a=r.create('Acme',{userId:'alice'}); const b=r.create('Beta',{userId:'bob'});
  assert.equal(r.membersFor(a.id).length,1); assert.equal(r.membersFor(b.id)[0].userId,'bob');
  r.addMember(a.id,'dev','developer'); r.setPlan(a.id,'pro');
  assert.equal(r.get(a.id).plan,'pro');
  assert.equal(r.authorize(a.id,'dev','billing').allowed,false);
  assert.equal(r.authorize(a.id,'alice','billing').allowed,true);
});

test('v2.3 usage metering enforces plan quotas', () => {
  const d=temp(); const orgs=new OrganizationRegistry({persistence:d}); const u=new UsageMeter({persistence:d}); const e=new EntitlementService({organizations:orgs,usage:u});
  const org=orgs.create('Quota',{userId:'owner'});
  u.increment(org.id,'runs',999); assert.equal(e.check(org.id,'runs',1).allowed,true); assert.equal(e.check(org.id,'runs',2).allowed,false);
  assert.throws(()=>e.consume(org.id,'runs',2), /Plan limit exceeded/);
  e.consume(org.id,'runs',1); assert.equal(e.usage(org.id,'runs').quantity,1000);
});

test('v2.3 billing is provider-neutral by default', async () => {
  const b=new BillingAdapter();
  assert.deepEqual(await b.createCheckout({orgId:'org_x',plan:'pro'}),{provider:'none',orgId:'org_x',plan:'pro',status:'not_configured'});
});

test('v2.3 SaaS control composes independent services', () => {
  const d=temp(); const s=createSaaSControl({persistence:d}); const o=s.organizations.create('Composable',{userId:'u'});
  assert.equal(s.entitlements.plan(o.id).name, PLANS.free.name);
});

test('v2.3 control plane exposes SaaS endpoints', async () => {
  const d=temp(); const gateway=createMCPGateway({mode:'enforce',policies:{productionBlock:true},tools:[]});
  const cp=createControlPlane({gateway,persistence:d,authRequired:false});
  const created=await cp.api('/api/organizations/create','POST',{name:'CloudCo',userId:'owner'});
  assert.equal(created.organization.name,'CloudCo');
  const orgId=created.organization.id;
  assert.equal((await cp.api('/api/organizations/plan','POST',{orgId,plan:'pro'})).organization.plan,'pro');
  await cp.api('/api/organizations/usage/consume','POST',{orgId,metric:'runs',quantity:2});
  assert.equal((await cp.api('/api/organizations/usage','GET',{}, {orgId})).usage[0].quantity,2);
  assert.equal((await cp.api('/api/organizations/entitlement','GET',{}, {orgId,metric:'runs',additional:1})).entitlement.allowed,true);
});
