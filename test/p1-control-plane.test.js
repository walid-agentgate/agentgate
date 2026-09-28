import test from 'node:test';
import assert from 'node:assert/strict';
import { createControlPlane } from '../src/control-plane.js';
import { createMCPGateway } from '../src/mcp-gateway.js';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

function tmp() { return fs.mkdtempSync(path.join(os.tmpdir(), 'agentgate-p1-')); }

test('P1 control plane exposes live attack lab and audit export', async () => {
  const dir = tmp();
  const gateway = createMCPGateway({
    mode: 'enforce',
    persistence: dir,
    policies: { productionBlock: true },
    tools: ['export_all','update_production','delete','refund','publish'].map(name => ({ name, handler: async () => 'should-not-execute' }))
  });
  const cp = createControlPlane({ gateway, persistence: dir, authRequired: false });
  const attack = await cp.api('/api/attack-lab', 'POST', {});
  assert.equal(attack.summary.total, 5);
  assert.equal(attack.summary.failed, 0);
  assert.ok(attack.results.every(x => x.runId));
  const audit = await cp.api('/api/audit/export', 'GET', {}, {});
  assert.equal(audit.version, '2.13.8');
  assert.ok(Array.isArray(audit.runs));
  assert.ok(Array.isArray(audit.approvals));
});

test('P1 policy lifecycle is available through the control plane', async () => {
  const dir = tmp();
  const gateway = createMCPGateway({ persistence: dir });
  const cp = createControlPlane({ gateway, persistence: dir, authRequired: false });
  const created = await cp.api('/api/policies/create', 'POST', { name:'p1-demo', policy:{ refund:{ maxAmount:5000 } } });
  assert.equal(created.policy.state, 'draft');
  const tested = await cp.api('/api/policies/test', 'POST', { name:'p1-demo', version:1, cases:[
    { name:'low', input:{ action:'refund', amount:100 }, expected:'ASK' },
    { name:'high', input:{ action:'refund', amount:6000 }, expected:'BLOCK' }
  ]});
  assert.equal(tested.test.passed, true);
  const active = await cp.api('/api/policies/activate', 'POST', { name:'p1-demo', version:1 });
  assert.equal(active.policy.state, 'active');
});

test('P1 HTTP approval and audit export endpoints work end-to-end', async () => {
  const dir = tmp();
  const gateway = createMCPGateway({ policies:{ approvalActions:['refund'] }, tools:[{name:'refund', handler:async()=>({ok:true})}] });
  const cp = createControlPlane({ gateway, persistence:dir, authRequired:false, html:'<html></html>' });
  const server = cp.server.listen(0);
  await new Promise(resolve => server.once('listening', resolve));
  const port = server.address().port;
  const r = await fetch(`http://127.0.0.1:${port}/api/attack-lab`, {method:'POST',headers:{'content-type':'application/json'},body:'{}'});
  assert.equal(r.status, 200);
  const created = await gateway.handle({jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'refund',action:'refund',arguments:{amount:100}}});
  const approvalId = created.result._agentgate.approvalId;
  const approve = await fetch(`http://127.0.0.1:${port}/api/approvals/approve`, {method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({approvalId})});
  assert.equal(approve.status, 200);
  const exported = await fetch(`http://127.0.0.1:${port}/api/audit/export`);
  assert.equal(exported.status, 200);
  const json = await exported.json();
  assert.equal(json.version, '2.13.8');
  assert.ok(json.runs.length >= 1);
  server.close();
});

test('Attack Lab reports unregistered tools as skipped, not security failures', async () => {
  const { runGatewayAttackLab, summarizeAttackResults } = await import('../src/attack-lab.js');
  const gateway = createMCPGateway({ mode:'enforce', policies:{ productionBlock:true }, tools:[
    {name:'delete', handler:async()=>({})}, {name:'refund', handler:async()=>({})}
  ]});
  const results = await runGatewayAttackLab(gateway);
  const summary = summarizeAttackResults(results);
  assert.equal(summary.failed, 0);
  assert.equal(summary.skipped, 3);
  assert.deepEqual(summary.unregisteredTools.sort(), ['export_all','publish','update_production']);
  assert.equal(summary.status, 'PARTIAL');
  assert.equal(results.filter(x=>x.skipped).length, 3);
});
