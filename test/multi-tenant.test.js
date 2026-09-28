import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { TenantRegistry, WebhookRegistry } from '../src/multi-tenant.js';

test('tenant registry isolates keys and supports rotation/revoke',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ag18-')); const r=new TenantRegistry({filePath:path.join(dir,'t.json'),keyPath:path.join(dir,'k.json')});
 const a=r.create('A'), b=r.create('B'); const k=r.issueKey(a.id,{scopes:['runs:read','policies:read']});
 assert.equal(r.authenticate(k.secret).tenantId,a.id); assert.equal(r.authorize(r.authenticate(k.secret),a.id,'runs:read'),true); assert.equal(r.authorize(r.authenticate(k.secret),b.id,'runs:read'),false);
 const rotated=r.rotate(r.authenticate(k.secret).id); assert.equal(r.authenticate(k.secret),null); assert.equal(r.authenticate(rotated.secret).tenantId,a.id); r.revoke(rotated.id); assert.equal(r.authenticate(rotated.secret),null); assert.equal(r.listKeys(b.id).length,0);
});

test('webhooks are tenant scoped and event filtered',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ag18w-')); const w=new WebhookRegistry({filePath:path.join(dir,'w.json'),deliveryPath:path.join(dir,'d.json')});
 const x=w.create('ten_a',{url:'https://example.com/hook',events:['run.blocked']}); const y=w.create('ten_b',{url:'https://example.com/hook',events:['*']});
 assert.equal(w.list('ten_a').length,1); assert.equal(w.list('ten_b').length,1); assert.equal(w.emit('ten_a','run.allowed',{}).length,0); assert.equal(w.emit('ten_a','run.blocked',{}).length,1); assert.equal(w.emit('ten_b','run.blocked',{}).length,1); assert.equal(w.deliveriesFor('ten_a').length,1);
});
