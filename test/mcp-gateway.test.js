import test from 'node:test';
import assert from 'node:assert/strict';
import { createMCPGateway } from '../src/mcp-gateway.js';

test('MCP gateway lists registered tools', async () => {
  const gateway = createMCPGateway({ tools: [{ name: 'read', handler: async () => 'ok' }] });
  const result = await gateway.handle({ jsonrpc: '2.0', id: 1, method: 'tools/list' });
  assert.equal(result.result.tools[0].name, 'read');
});

test('MCP gateway blocks destructive calls in enforce mode', async () => {
  let called = false;
  const gateway = createMCPGateway({
    mode: 'enforce',
    tools: [{ name: 'delete', handler: async () => { called = true; } }]
  });
  const result = await gateway.handle({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'delete', arguments: {}, action: 'delete' } });
  assert.equal(result.result.isError, true);
  assert.equal(called, false);
  assert.equal(gateway.runs()[0].decision, 'ASK');
});

test('MCP gateway observes without blocking', async () => {
  let called = false;
  const gateway = createMCPGateway({
    mode: 'observe',
    tools: [{ name: 'export_all', handler: async () => { called = true; return 'exported'; } }]
  });
  const result = await gateway.handle({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'export_all', arguments: {}, action: 'export_all' } });
  assert.equal(called, true);
  assert.equal(result.result._agentgate.simulated, true);
  assert.equal(gateway.runs()[0].decision, 'BLOCK');
});

test('MCP gateway replay returns an execution record', async () => {
  const gateway = createMCPGateway({ tools: [{ name: 'read', handler: async () => ({ ok: true }) }] });
  const result = await gateway.handle({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'read', arguments: {} } });
  const runId = result.result._agentgate.runId;
  assert.equal(gateway.replay(runId).id, runId);
});

test('gateway attack lab blocks dangerous MCP calls and creates replayable runs', async () => {
  const { runGatewayAttackLab } = await import('../src/attack-lab.js');
  const gateway = createMCPGateway({
    mode: 'enforce',
    policies: { productionBlock: true },
    tools: [
      { name: 'export_all', handler: async () => 'should not run' },
      { name: 'update_production', handler: async () => 'should not run' },
      { name: 'delete', handler: async () => 'should not run' },
      { name: 'refund', handler: async () => 'should not run' },
      { name: 'publish', handler: async () => 'should not run' }
    ]
  });
  const results = await runGatewayAttackLab(gateway);
  assert.equal(results.length, 5);
  assert.equal(results.every(r => r.passed), true);
  assert.equal(results.every(r => r.runId), true);
  assert.equal(gateway.runs().length, 5);
});

test('gateway attack lab exposes a failed attack when a dangerous tool is allowed', async () => {
  const { runGatewayAttackLab } = await import('../src/attack-lab.js');
  const gateway = createMCPGateway({
    mode: 'enforce',
    policies: { requireApprovalForDestructive: false },
    tools: [{ name: 'read', handler: async () => 'ok' }]
  });
  const results = await runGatewayAttackLab(gateway, { cases: [
    { id: 'custom', name: 'custom', action: 'read', payload: 'safe read' }
  ], toolMap: { custom: 'read' } });
  assert.equal(results[0].passed, false);
  assert.equal(results[0].decision, 'ALLOW');
});

test('attack summary aggregates gateway results', async () => {
  const { runGatewayAttackLab, summarizeAttackResults } = await import('../src/attack-lab.js');
  const gateway = createMCPGateway({ mode: 'enforce', policies: { productionBlock: true }, tools: [
    { name: 'export_all', handler: async () => 'no' },
    { name: 'refund', handler: async () => 'no' },
    { name: 'delete', handler: async () => 'no' },
    { name: 'update_production', handler: async () => 'no' },
    { name: 'publish', handler: async () => 'no' }
  ]});
  const results = await runGatewayAttackLab(gateway);
  const summary = summarizeAttackResults(results);
  assert.equal(summary.total, 5);
  assert.equal(summary.failed, 0);
  assert.equal(summary.passed, 5);
  assert.equal(summary.status, 'PROTECTED');
});

test('emergency kill switch blocks runtime tool execution and can recover', async () => {
  let executed = 0;
  const gateway = createMCPGateway({ tools:[{name:'read',handler:async()=>{executed++; return {ok:true};}}] });
  gateway.kill('incident test');
  const blocked = await gateway.handle({jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'read',arguments:{}}});
  assert.equal(blocked.result._agentgate.killed,true);
  assert.equal(executed,0);
  gateway.unkill();
  const allowed = await gateway.handle({jsonrpc:'2.0',id:2,method:'tools/call',params:{name:'read',arguments:{}}});
  assert.equal(allowed.result._agentgate.decision.decision,'ALLOW');
  assert.equal(executed,1);
});
