import test from 'node:test';
import assert from 'node:assert/strict';
import { createControlPlane } from '../src/control-plane.js';
import { TenantRegistry } from '../src/multi-tenant.js';

test('control plane kill switch changes runtime state', async()=>{
 const registry=new TenantRegistry({filePath:'.agentgate/test-kill-tenants.json',keyPath:'.agentgate/test-kill-keys.json'});
 const tenant=registry.create('kill-test'); const key=registry.issueKey(tenant.id,{scopes:['admin:*']});
 const cp=createControlPlane({authRequired:true,tenantRegistry:registry});
 const killed=await cp.api('/api/kill-switch','POST',{reason:'incident'}, {}, {tenantId:tenant.id});
 assert.equal(killed.killed,true); assert.equal(cp.gateway.isKilled(),true);
 const status=await cp.api('/api/kill-switch','GET',{}, {}, {tenantId:tenant.id}); assert.equal(status.killed,true);
 await cp.api('/api/kill-switch','POST',{enabled:false}, {}, {tenantId:tenant.id}); assert.equal(cp.gateway.isKilled(),false);
});
