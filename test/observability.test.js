import test from 'node:test';
import assert from 'node:assert/strict';
import { PricingRegistry, calculateCost, CostController, analyzeObservability, createObservability, buildUnifiedTrace, calculateAgentEfficiency, forecastCost, correlateBehaviorCostSecurity, analyzeCostAnalytics } from '../src/observability.js';
import { createMCPGateway } from '../src/mcp-gateway.js';

test('cost calculation supports input/output/cached tokens', () => {
  const pricing = new PricingRegistry({ demo: { inputPer1M: 1, outputPer1M: 2, cachedInputPer1M: 0.25 } });
  const cost = calculateCost({ model: 'demo', usage: { inputTokens: 1_000_000, cachedInputTokens: 200_000, outputTokens: 500_000 } }, pricing.list());
  assert.equal(cost.known, true);
  assert.equal(cost.total, 1.85);
});

test('budget controller returns ASK then BLOCK deterministically', () => {
  const c = new CostController({ budgets: { daily: { ask: 5, hard: 10 }, monthly: { ask: 0, hard: 0 } } });
  c.record({ id:'r1', tenantId:'t1', request:{agent:'a'}, createdAt:new Date().toISOString() }, { total: 4, currency:'USD' });
  assert.equal(c.evaluate({ tenantId:'t1', agent:'a', estimatedCost:2 }).decision, 'ASK');
  assert.equal(c.evaluate({ tenantId:'t1', agent:'a', estimatedCost:7 }).decision, 'BLOCK');
});

test('observability produces latency, security and cost summaries', () => {
  const report = analyzeObservability([
    { id:'1', decision:'ALLOW', executed:true, durationMs:10, request:{tool:'read',agent:'a'}, cost:{total:0.01,known:true} },
    { id:'2', decision:'BLOCK', risk:95, durationMs:30, request:{tool:'delete',agent:'a'}, cost:{total:0.02,known:true}, egressBlocked:true }
  ]);
  assert.equal(report.runs, 2);
  assert.equal(report.decisions.BLOCK, 1);
  assert.equal(report.latency.p50, 20);
  assert.equal(report.security.egressBlocked, 1);
  assert.equal(report.cost.total, 0.03);
});

test('gateway records observability data without weakening policy decisions', async () => {
  const gateway = createMCPGateway({
    pricing: { demo: { inputPer1M: 1, outputPer1M: 2 } },
    tools: [{ name:'read', handler: async () => ({ ok:true }) }]
  });
  const response = await gateway.handle({ jsonrpc:'2.0', id:1, method:'tools/call', params:{ name:'read', model:'demo', usage:{inputTokens:1000,outputTokens:2000} } });
  assert.equal(response.result._agentgate.runId ? true : false, true);
  const run = gateway.runs()[0];
  assert.equal(run.decision, 'ALLOW');
  assert.equal(run.cost.known, true);
  assert.equal(run.cost.total, 0.005);
  assert.equal(typeof run.durationMs, 'number');
  assert.equal(gateway.observability.analyze(gateway.runs()).cost.knownRuns, 1);
});

test('cost budget can force ASK before a tool executes', async () => {
  let executed = false;
  const gateway = createMCPGateway({ budgets:{daily:{ask:1,hard:2}}, tools:[{name:'read',handler:async()=>{executed=true;return {ok:true}}}] });
  const response = await gateway.handle({ jsonrpc:'2.0', id:1, method:'tools/call', params:{name:'read', estimatedCost:1.5} });
  assert.equal(response.result._agentgate.approvalRequired, true);
  assert.equal(executed, false);
  assert.equal(gateway.runs()[0].reason, 'Cost approval threshold reached');
});

test('control plane exposes observability and cost endpoints', async () => {
  const { createControlPlane } = await import('../src/control-plane.js');
  const gateway = createMCPGateway({ pricing:{demo:{inputPer1M:1,outputPer1M:2}}, tools:[{name:'read',handler:async()=>({ok:true})}] });
  const cp = createControlPlane({ gateway, authRequired:false });
  await gateway.handle({jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'read',model:'demo',usage:{inputTokens:1000,outputTokens:1000}}});
  const obs = await cp.api('/api/observability','GET',{},{});
  const cost = await cp.api('/api/cost','GET',{},{});
  const pricing = await cp.api('/api/cost/pricing','GET',{},{});
  assert.equal(obs.runs,1);
  assert.equal(obs.latency.count,1);
  assert.equal(cost.daily > 0,true);
  assert.equal(pricing.pricing.demo.outputPer1M,2);
});

test('budget evaluation can use persisted run history instead of in-memory cost events', () => {
  const c = new CostController({ budgets:{daily:{ask:5,hard:10}} });
  const history = [{ createdAt:new Date().toISOString(), tenantId:'t1', request:{agent:'a'}, cost:{total:6} }];
  assert.equal(c.evaluate({tenantId:'t1',agent:'a',estimatedCost:0.1,history}).decision,'ASK');
  assert.equal(c.evaluate({tenantId:'t1',agent:'a',estimatedCost:5,history}).decision,'BLOCK');
});

test('unified trace contains security, approval, egress, behavior and cost stages', () => {

  const trace = buildUnifiedTrace({
    id:'trace-1', createdAt:new Date().toISOString(), decision:'ASK', risk:72, reason:'Approval required', approvalId:'ap-1', executed:true,
    durationMs:1400, request:{agent:'Refund Agent',model:'demo',tool:'refund_customer',action:'refund',amount:4200},
    cost:{total:0.084,known:true,currency:'USD'}, egress:{action:'ALLOW',findings:[],risk:0}
  });
  assert.deepEqual(trace.events.map(x=>x.stage), ['LLM','TOOL','POLICY','HUMAN_APPROVAL','TOOL_EXECUTION','RESPONSE_EGRESS','BEHAVIOR','COST']);
  assert.equal(trace.security.approvalId,'ap-1');
});

test('agent efficiency score is deterministic and exposes a transparent breakdown', () => {

  const runs = [
    {id:'a1',executed:true,durationMs:500,decision:'ALLOW',request:{agent:'Refund Agent',context:{taskId:'t1'}},cost:{total:0.04}},
    {id:'a2',executed:true,durationMs:700,decision:'ALLOW',request:{agent:'Refund Agent',context:{taskId:'t1'}},cost:{total:0.04}},
    {id:'a3',executed:true,durationMs:600,decision:'ALLOW',request:{agent:'Refund Agent',context:{taskId:'t2'}},cost:{total:0.05}},
    {id:'a4',executed:true,durationMs:800,decision:'ASK',request:{agent:'Refund Agent',context:{taskId:'t3'}},cost:{total:0.06}}
  ];
  const r = calculateAgentEfficiency(runs,'Refund Agent');
  assert.equal(typeof r.score,'number');
  assert.equal(r.metrics.successfulTasks,3);
  assert.equal(r.metrics.avgToolCalls,1.33);
  assert.ok(r.breakdown.success <= 100 && r.breakdown.success >= 0);
});

test('cost forecast uses deterministic month-to-date run-rate', () => {

  const now = new Date('2026-09-15T12:00:00Z');
  const r = forecastCost([
    {createdAt:'2026-09-01T01:00:00Z',cost:{total:10}},
    {createdAt:'2026-09-15T01:00:00Z',cost:{total:20}},
    {createdAt:'2026-08-31T23:59:00Z',cost:{total:100}}
  ], {now, monthlyBudget:100});
  assert.equal(r.monthToDate,30);
  assert.equal(r.daysInMonth,30);
  assert.equal(r.forecast,60);
  assert.equal(r.varianceVsBudget,-40);
});

test('behavior correlation joins anomalies to cost and security outcomes', () => {

  const runs = [
    {id:'1',createdAt:'2026-01-01T00:00:00Z',decision:'ALLOW',executed:true,request:{agent:'a',action:'read'},cost:{total:0.1}},
    {id:'2',createdAt:'2026-01-01T00:00:01Z',decision:'ASK',executed:false,request:{agent:'a',action:'refund',context:{taskId:'x'}},cost:{total:1}},
    {id:'3',createdAt:'2026-01-01T00:00:02Z',decision:'BLOCK',executed:false,request:{agent:'a',action:'export_all',scope:'all'},cost:{total:1}}
  ];
  const r = correlateBehaviorCostSecurity(runs);
  assert.ok(r.anomalyRuns >= 1);
  assert.ok(r.blockedAnomalyRuns >= 1);
  assert.equal(typeof r.securityCorrelation.status,'string');
});

test('cost analytics exposes agent, model, tool, tenant, customer, action and security cost', () => {

  const r = analyzeCostAnalytics([
    {tenantId:'t1',request:{agent:'a',model:'m',tool:'refund',action:'refund',userId:'u1'},decision:'ALLOW',executed:true,cost:{total:2,usage:{totalTokens:100}}},
    {tenantId:'t1',request:{agent:'a',model:'m',tool:'delete',action:'delete',userId:'u1'},decision:'BLOCK',cost:{total:0.5,usage:{totalTokens:50}}}
  ]);
  assert.equal(r.byAgent.a.cost,2.5);
  assert.equal(r.byModel.m.cost,2.5);
  assert.equal(r.byTenant.t1.cost,2.5);
  assert.equal(r.byCustomer.u1.cost,2.5);
  assert.equal(r.securityCost.blockedCalls,0.5);
  assert.equal(r.byAction.delete.blocked,1);
});

test('control plane exposes trace, efficiency, correlation, analytics and forecast APIs', async () => {
  const { createControlPlane } = await import('../src/control-plane.js');
  const gateway = createMCPGateway({ pricing:{demo:{inputPer1M:1,outputPer1M:2}}, tools:[{name:'read',handler:async()=>({ok:true})}] });
  const cp = createControlPlane({ gateway, authRequired:false });
  await gateway.handle({jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'read',agent:'a',model:'demo',usage:{inputTokens:1000,outputTokens:1000}}});
  const runId = gateway.runs()[0].id;
  const trace = await cp.api('/api/trace','GET',{}, {runId}, {});
  const efficiency = await cp.api('/api/efficiency','GET',{}, {}, {});
  const correlation = await cp.api('/api/behavior/correlation','GET',{}, {}, {});
  const analytics = await cp.api('/api/cost/analytics','GET',{}, {}, {});
  const forecast = await cp.api('/api/cost/forecast','GET',{}, {}, {});
  assert.equal(trace.runId,runId);
  assert.equal(typeof efficiency.byAgent.a.score,'number');
  assert.equal(typeof correlation.securityCorrelation.status,'string');
  assert.equal(analytics.byAgent.a.runs,1);
  assert.equal(typeof forecast.forecast,'number');
});

