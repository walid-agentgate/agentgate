import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createControlPlane } from '../src/control-plane.js';
import { createMCPGateway } from '../src/mcp-gateway.js';
import { TenantRegistry, WebhookRegistry } from '../src/multi-tenant.js';
import { validateWebhookTarget } from '../src/webhook-delivery.js';

test('control plane rejects cross-tenant body injection', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ag24-tenant-'));
  const registry = new TenantRegistry({filePath:path.join(dir,'t.json'), keyPath:path.join(dir,'k.json')});
  const a = registry.create('A');
  const b = registry.create('B');
  const key = registry.issueKey(a.id, {scopes:['webhooks:write','admin:*']});
  const cp = createControlPlane({persistence:dir, tenantRegistry:registry});
  await new Promise(r => cp.server.listen(0, '127.0.0.1', r));
  const port = cp.server.address().port;
  const res = await fetch(`http://127.0.0.1:${port}/api/webhooks/create`, {
    method:'POST', headers:{authorization:`Bearer ${key.secret}`,'content-type':'application/json'},
    body:JSON.stringify({tenantId:b.id,url:'https://example.com/hook'})
  });
  assert.equal(res.status,403);
  assert.equal(registry.list().length,2);
  cp.server.close();
});

test('gateway isolates runs, replay and approvals by tenant', async () => {
  let executed = 0;
  const gateway = createMCPGateway({tools:[{name:'refund',handler:async()=>{executed++; return 'ok';}}]});
  const a = await gateway.handle({jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'refund',tenantId:'tenant-A',arguments:{amount:1000}}});
  const b = await gateway.handle({jsonrpc:'2.0',id:2,method:'tools/call',params:{name:'refund',tenantId:'tenant-B',arguments:{amount:1000}}});
  const approvalA = a.result._agentgate.approvalId;
  const approvalB = b.result._agentgate.approvalId;
  const runA = a.result._agentgate.runId;
  assert.equal(gateway.runs('tenant-A').length,1);
  assert.equal(gateway.runs('tenant-B').length,1);
  assert.equal(gateway.replay(runA,'tenant-B'),null);
  assert.equal(gateway.getApproval(approvalA,'tenant-B'),null);
  assert.equal((await gateway.approve(approvalA,'tenant-B')).ok,false);
  assert.equal((await gateway.approve(approvalA,'tenant-A')).status,'executed');
  assert.equal((await gateway.approve(approvalB,'tenant-B')).status,'executed');
  assert.equal(executed,2);
});

test('webhook SSRF protection blocks local and private targets', async () => {
  for (const url of ['http://127.0.0.1/hook','http://10.0.0.1/hook','http://169.254.169.254/latest/meta-data','http://localhost/hook']) {
    await assert.rejects(() => validateWebhookTarget(url, {lookup:async()=>[{address:'127.0.0.1',family:4}]}), /blocked/);
  }
  const publicUrl = await validateWebhookTarget('https://example.com/hook', {lookup:async()=>[{address:'93.184.216.34',family:4}]});
  assert.equal(publicUrl.hostname,'example.com');
});

test('webhook registry rejects obvious private IPs at creation', () => {
  const r = new WebhookRegistry({filePath:path.join(os.tmpdir(),`ag24-wh-${Date.now()}.json`),deliveryPath:path.join(os.tmpdir(),`ag24-wd-${Date.now()}.json`)});
  assert.throws(() => r.create('tenant-A',{url:'http://192.168.1.10/hook'}),/blocked/);
  assert.throws(() => r.create('tenant-A',{url:'http://127.0.0.1/hook'}),/blocked/);
});

test('MCP HTTP server is local-only by default and requires auth for non-local mode', async () => {
  const { createMCPGatewayServer } = await import('../src/mcp-gateway.js');
  const local = createMCPGatewayServer({localOnly:true});
  await new Promise(r => local.server.listen(0, '127.0.0.1', r));
  const port = local.server.address().port;
  const res = await fetch(`http://127.0.0.1:${port}/mcp`, {method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'ping'})});
  assert.equal(res.status,200);
  local.server.close();
  const remote = createMCPGatewayServer({localOnly:false});
  await new Promise(r => remote.server.listen(0, '127.0.0.1', r));
  const port2 = remote.server.address().port;
  const res2 = await fetch(`http://127.0.0.1:${port2}/mcp`, {method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'ping'})});
  assert.equal(res2.status,401);
  remote.server.close();
});
