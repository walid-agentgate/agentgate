import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createMCPGateway } from '../src/mcp-gateway.js';
import { createControlPlane } from '../src/control-plane.js';
import { createPersistentRunStore } from '../src/persistent-store.js';

test('persistent run store survives recreation', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentgate-'));
  const file = path.join(dir, 'runs.json');
  const first = createPersistentRunStore({ filePath: file });
  first.add({ id:'run_test', decision:'BLOCK', risk:95 });
  const second = createPersistentRunStore({ filePath: file });
  assert.equal(second.get('run_test').decision, 'BLOCK');
});

test('gateway persists runs and approvals', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentgate-'));
  const gateway = createMCPGateway({ persistence: dir, tools:[{name:'refund',handler:async()=> 'ok'}] });
  const result = await gateway.handle({jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'refund',arguments:{amount:900},action:'refund',agent:'Demo'}});
  assert.equal(gateway.runs().length, 1);
  assert.equal(gateway.approvals('pending').length, 1);
  const gateway2 = createMCPGateway({ persistence: dir, tools:[{name:'refund',handler:async()=> 'ok'}] });
  assert.equal(gateway2.runs().length, 1);
  assert.equal(gateway2.approvals('pending').length, 1);
  assert.ok(result.result._agentgate.approvalId);
});

test('control plane registers agents', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentgate-'));
  const cp = createControlPlane({ persistence: dir });
  const created = await cp.api('/api/agents/register','POST',{name:'CheckoutAgent',environment:'production'});
  const listed = await cp.api('/api/agents');
  assert.equal(created.agent.name, 'CheckoutAgent');
  assert.equal(listed.agents.length, 1);
});
