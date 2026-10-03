import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { TenantRegistry } from '../src/multi-tenant.js';
import { createAuthMiddleware, extractAPIKey } from '../src/auth.js';
import { createWebhookDispatcher, signWebhook } from '../src/webhook-delivery.js';
import { PostgresStoreAdapter, createSupabaseAdapter } from '../src/postgres-adapter.js';

// Use a fresh temp directory instead of a hardcoded /tmp/... path — on some
// systems (containers, Termux, Windows) a bare /tmp either doesn't exist or
// isn't writable by the current user, which fails with ENOENT/EACCES before
// the test logic even runs.
const v19Dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentgate-v19-'));

test('auth middleware extracts bearer/key and enforces tenant scope',()=>{
 const r=new TenantRegistry({filePath:path.join(v19Dir,'ag19-t.json'),keyPath:path.join(v19Dir,'ag19-k.json')}); const t=r.create('A'); const k=r.issueKey(t.id,{scopes:['runs:read']}); const auth=createAuthMiddleware({registry:r});
 assert.equal(extractAPIKey({'authorization':`Bearer ${k.secret}`}),k.secret); assert.equal(auth({headers:{'x-agentgate-key':k.secret}},'/api/runs','runs:read').ok,true); assert.equal(auth({headers:{}},'/api/runs','runs:read').status,401); assert.equal(auth({headers:{'x-agentgate-key':k.secret}},'/api/policies/create','policies:write').status,403);
});

test('webhook dispatcher signs, retries and succeeds',async()=>{
 let calls=0; const d=createWebhookDispatcher({maxAttempts:3,lookup:async()=>[{address:'93.184.216.34',family:4}],fetch:async(url,opts)=>{calls++; if(calls===1)return new Response('fail',{status:500}); return new Response('ok',{status:200});}}); const body=JSON.stringify({x:1}); assert.match(signWebhook('secret',body),/^sha256=/); const result=await d({url:'https://example.com',secret:'secret'},{id:'d1',event:'run.blocked',tenantId:'t1',payload:{x:1},createdAt:new Date().toISOString()}); assert.equal(result.status,'delivered'); assert.equal(result.attempts,2); assert.equal(calls,2);
});

test('postgres adapter scopes reads by tenant',async()=>{
 const calls=[]; const client={query:async(sql,args)=>{calls.push({sql,args}); return {rows:sql.startsWith('select')?[{data:{id:'r1',tenantId:'t1'}}]:[]};}}; const a=new PostgresStoreAdapter({client}); await a.add({id:'r1',tenantId:'t1',kind:'run'}); const x=await a.get('r1','t1'); assert.equal(x.tenantId,'t1'); assert.match(calls[0].sql,/tenant_id/); assert.equal(calls[0].args[1],'t1');
});

test('supabase adapter forwards tenant filter',async()=>{
 const log=[]; const make=()=>({select(){log.push('select');return this},eq(k,v){log.push([k,v]);return this},order(){return this},maybeSingle:async()=>({data:{data:{id:'r'}},error:null})}); const sb={from(){return make()}}; const a=createSupabaseAdapter(sb); const x=await a.get('r','t1'); assert.equal(x.id,'r'); assert.deepEqual(log[1],['id','r']); assert.deepEqual(log[2],['tenant_id','t1']);
});

test('control plane HTTP fails closed and accepts scoped API keys',async()=>{
 const { createControlPlane } = await import('../src/control-plane.js');
 const { TenantRegistry } = await import('../src/multi-tenant.js');
 const fs = await import('node:fs'); const os = await import('node:os'); const path = await import('node:path');
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ag19-http-')); const registry=new TenantRegistry({filePath:path.join(dir,'t.json'),keyPath:path.join(dir,'k.json')}); const tenant=registry.create('HTTP'); const key=registry.issueKey(tenant.id,{scopes:['runs:read']}); const cp=createControlPlane({persistence:dir,tenantRegistry:registry}); await new Promise(r=>cp.server.listen(0,r)); const port=cp.server.address().port;
 let res=await fetch(`http://127.0.0.1:${port}/api/runs`); assert.equal(res.status,401); res=await fetch(`http://127.0.0.1:${port}/api/runs`,{headers:{authorization:`Bearer ${key.secret}`}}); assert.equal(res.status,200); res=await fetch(`http://127.0.0.1:${port}/api/policies/create`,{method:'POST',headers:{authorization:`Bearer ${key.secret}`,'content-type':'application/json'},body:JSON.stringify({name:'x',policy:{}})}); assert.equal(res.status,403); cp.server.close();
});
