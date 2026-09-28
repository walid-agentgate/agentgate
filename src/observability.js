/**
 * AgentGate Observability + Cost Control + Security-Aware Analytics.
 * Deterministic analytics over runtime runs; no LLM is used for scoring or authorization.
 */

import { analyzeBehavior } from './behavior.js';

export const COST_DECISIONS = Object.freeze({ ALLOW: 'ALLOW', ASK: 'ASK', BLOCK: 'BLOCK' });

const DEFAULT_PRICING = Object.freeze({});

export class PricingRegistry {
  constructor(pricing = {}) { this.pricing = { ...DEFAULT_PRICING, ...normalizePricingMap(pricing) }; }
  set(model, price = {}) {
    const name = String(model || '').trim();
    if (!name) throw new TypeError('Model name is required');
    this.pricing[name] = normalizePrice(price);
    return this.pricing[name];
  }
  get(model) { return this.pricing[String(model || '')] || null; }
  list() { return structuredCloneSafe(this.pricing); }
}

export function calculateCost(input = {}, pricing = {}) {
  const usage = normalizeUsage(input.usage || input);
  const model = input.model || input.usage?.model || null;
  const price = input.price || pricing[model] || null;
  if (!price) return { currency: 'USD', total: 0, known: false, model, usage };
  const inputRate = Number(price.inputPer1M ?? price.input ?? 0);
  const outputRate = Number(price.outputPer1M ?? price.output ?? 0);
  const cachedRate = Number(price.cachedInputPer1M ?? price.cachedInput ?? 0);
  const inputTokens = Math.max(0, usage.inputTokens - usage.cachedInputTokens);
  const cachedTokens = Math.max(0, usage.cachedInputTokens);
  const outputTokens = Math.max(0, usage.outputTokens);
  const total = (inputTokens / 1_000_000) * inputRate +
    (cachedTokens / 1_000_000) * cachedRate +
    (outputTokens / 1_000_000) * outputRate;
  return {
    currency: price.currency || 'USD',
    total: roundMoney(total),
    known: true,
    model,
    usage,
    rates: { inputPer1M: inputRate, outputPer1M: outputRate, cachedInputPer1M: cachedRate }
  };
}

export class CostController {
  constructor(options = {}) {
    this.budgets = normalizeBudgets(options.budgets || {});
    this.events = [];
    this.maxEvents = options.maxEvents || 5000;
  }
  configure(budgets = {}) { this.budgets = normalizeBudgets(budgets); return this.budgets; }
  record(run, cost = {}) {
    const amount = Number(cost.total || 0);
    const event = {
      runId: run.id,
      tenantId: run.tenantId || null,
      agent: run.request?.agent || 'unknown',
      cost: amount,
      currency: cost.currency || 'USD',
      at: run.createdAt || new Date().toISOString()
    };
    this.events.unshift(event);
    if (this.events.length > this.maxEvents) this.events.pop();
    return event;
  }
  evaluate({ tenantId = null, agent = null, estimatedCost = 0, now = new Date(), history = null } = {}) {
    const amount = Math.max(0, Number(estimatedCost) || 0);
    const daily = this.spent({ tenantId, agent, period: 'daily', now, history }) + amount;
    const monthly = this.spent({ tenantId, agent, period: 'monthly', now, history }) + amount;
    const d = this.budgets.daily;
    const m = this.budgets.monthly;
    if ((d.hard > 0 && daily > d.hard) || (m.hard > 0 && monthly > m.hard)) {
      return { decision: COST_DECISIONS.BLOCK, reason: 'Cost budget would be exceeded', daily, monthly };
    }
    if ((d.ask > 0 && daily > d.ask) || (m.ask > 0 && monthly > m.ask)) {
      return { decision: COST_DECISIONS.ASK, reason: 'Cost approval threshold reached', daily, monthly };
    }
    return { decision: COST_DECISIONS.ALLOW, reason: 'Cost budget within configured thresholds', daily, monthly };
  }
  spent({ tenantId = null, agent = null, period = 'daily', now = new Date(), history = null } = {}) {
    const date = now instanceof Date ? now : new Date(now);
    const start = period === 'monthly'
      ? new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1))
      : new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
    if (Array.isArray(history)) {
      return history.filter(r => new Date(r.createdAt) >= start && (!tenantId || r.tenantId === tenantId) && (!agent || (r.request?.agent || 'unknown') === agent))
        .reduce((sum, r) => sum + Number(r.cost?.total || 0), 0);
    }
    return this.events.filter(e => new Date(e.at) >= start && (!tenantId || e.tenantId === tenantId) && (!agent || e.agent === agent))
      .reduce((sum, e) => sum + Number(e.cost || 0), 0);
  }
  snapshot({ tenantId = null, agent = null, now = new Date(), history = null } = {}) {
    const daily = this.spent({ tenantId, agent, period: 'daily', now, history });
    const monthly = this.spent({ tenantId, agent, period: 'monthly', now, history });
    return {
      currency: 'USD',
      daily: roundMoney(daily),
      monthly: roundMoney(monthly),
      budgets: structuredCloneSafe(this.budgets),
      remaining: {
        daily: remaining(this.budgets.daily.hard, daily),
        monthly: remaining(this.budgets.monthly.hard, monthly)
      }
    };
  }
}

/**
 * Full deterministic observability report. The report intentionally joins
 * runtime, cost, security and behavior data instead of treating traces as logs.
 */
export function analyzeObservability(runs = [], options = {}) {
  const list = Array.isArray(runs) ? runs : [];
  const latencies = list.map(r => Number(r.durationMs)).filter(Number.isFinite).sort((a, b) => a - b);
  const decisions = countBy(list, r => r.decision || 'UNKNOWN');
  const tools = groupStats(list, r => r.request?.tool || r.request?.action || 'unknown');
  const agents = groupStats(list, r => r.request?.agent || 'unknown');
  const models = groupStats(list, r => r.request?.model || r.cost?.model || 'unknown');
  const security = {
    blocked: decisions.BLOCK || 0,
    approvalRequired: decisions.ASK || 0,
    egressBlocked: list.filter(r => r.egressBlocked).length,
    egressRedacted: list.filter(r => r.egress?.action === 'REDACT').length,
    highRisk: list.filter(r => Number(r.risk) >= 70).length,
    criticalRisk: list.filter(r => Number(r.risk) >= 90).length
  };
  const costs = list.map(r => Number(r.cost?.total || 0)).filter(Number.isFinite);
  const knownCosts = list.filter(r => r.cost?.known);
  const behavior = analyzeBehavior(list, options.behavior || {});
  const costAnalytics = analyzeCostAnalytics(list, options);
  const efficiency = analyzeAgentEfficiency(list, options);
  const forecast = forecastCost(list, options);
  const correlation = correlateBehaviorCostSecurity(list, behavior);
  const traces = list.map(buildUnifiedTrace);

  return {
    runs: list.length,
    decisions,
    successRate: list.length ? round((list.filter(r => r.executed && !r.error && !r.egressBlocked).length / list.length) * 100, 2) : 0,
    errorRate: list.length ? round((list.filter(r => r.error).length / list.length) * 100, 2) : 0,
    latency: percentileSummary(latencies),
    security,
    cost: {
      total: roundMoney(costs.reduce((a, b) => a + b, 0)),
      average: costs.length ? roundMoney(costs.reduce((a, b) => a + b, 0) / costs.length) : 0,
      knownRuns: knownCosts.length,
      unknownRuns: list.length - knownCosts.length,
      currency: options.currency || 'USD'
    },
    tools,
    agents,
    models,
    efficiency,
    forecast,
    behavior,
    correlation,
    costAnalytics,
    traces,
    generatedAt: new Date().toISOString()
  };
}

/** Build the security-aware trace shown by AgentGate instead of a generic log trace. */
export function buildUnifiedTrace(run = {}) {
  const request = run.request || {};
  const events = [];
  const at = run.createdAt || new Date().toISOString();
  const add = (stage, detail, status = 'INFO') => events.push({ stage, status, detail });

  add('LLM', { agent: request.agent || 'unknown', model: request.model || run.cost?.model || 'unknown', usage: run.cost?.usage || request.usage || null });
  add('TOOL', { tool: request.tool || request.action || 'unknown', action: request.action || request.tool || 'unknown', amount: request.amount ?? null });
  add('POLICY', { decision: run.decision || 'UNKNOWN', risk: Number(run.risk || 0), reason: run.reason || null });

  if (run.approvalId || run.approval || run.status === 'pending_approval' || run.decision === 'ASK') {
    const approvalStatus = run.approval?.status || (run.status === 'pending_approval' ? 'PENDING' : 'REQUIRED');
    add('HUMAN_APPROVAL', { approvalId: run.approvalId || null, status: approvalStatus }, approvalStatus === 'APPROVED' ? 'PASS' : 'CONTROL');
  }

  if (run.executed) add('TOOL_EXECUTION', { status: run.error ? 'ERROR' : 'EXECUTED', latencyMs: run.durationMs ?? null });
  if (run.egress) add('RESPONSE_EGRESS', { action: run.egress.action, findings: run.egress.findings || [], risk: run.egress.risk || 0 }, run.egress.action === 'BLOCK' ? 'BLOCK' : run.egress.action === 'REDACT' ? 'CONTROL' : 'PASS');
  if (run.error) add('ERROR', { message: run.error }, 'ERROR');

  const behaviorStatus = Number(run.behaviorRisk || run.risk || 0) >= 70 ? 'HIGH_RISK' : 'NORMAL';
  add('BEHAVIOR', { status: behaviorStatus, risk: Number(run.behaviorRisk || 0) || null });
  add('COST', { amount: Number(run.cost?.total || 0), currency: run.cost?.currency || 'USD', known: Boolean(run.cost?.known), budget: run.cost?.budget || null });

  return {
    runId: run.id || null,
    agent: request.agent || 'unknown',
    model: request.model || run.cost?.model || null,
    tenantId: run.tenantId || null,
    decision: run.decision || 'UNKNOWN',
    risk: Number(run.risk || 0),
    status: run.status || (run.executed ? 'executed' : 'decided'),
    latencyMs: Number.isFinite(Number(run.durationMs)) ? Number(run.durationMs) : null,
    cost: run.cost || { total: 0, known: false },
    security: {
      policyDecision: run.decision || 'UNKNOWN',
      egress: run.egress || null,
      egressBlocked: Boolean(run.egressBlocked),
      approvalId: run.approvalId || null,
      risk: Number(run.risk || 0)
    },
    events,
    createdAt: at
  };
}

/**
 * Deterministic Agent Efficiency score. Formula is deliberately transparent:
 * success 30%, error-free reliability 20%, tool economy 15%, latency 15%,
 * control friction 10%, cost efficiency 10%. No model/LLM judgment is used.
 */
export function calculateAgentEfficiency(runs = [], agent = null, options = {}) {
  const scoped = (runs || []).filter(r => !agent || (r.request?.agent || 'unknown') === agent);
  if (!scoped.length) return { agent: agent || 'unknown', score: 0, status: 'NO_DATA', breakdown: {}, metrics: {} };
  const success = ratio(scoped, r => r.executed && !r.error && !r.egressBlocked) * 100;
  const reliability = (1 - ratio(scoped, r => Boolean(r.error))) * 100;
  const taskCalls = averageToolCallsPerTask(scoped);
  const toolEconomy = scoreLowerIsBetter(taskCalls, Number(options.idealToolCalls || 4), Number(options.maxToolCalls || 12));
  const latencies = scoped.map(r => Number(r.durationMs)).filter(Number.isFinite).sort((a,b)=>a-b);
  const latencyP50 = percentileSummary(latencies).p50;
  const latencyScore = scoreLowerIsBetter(latencyP50, Number(options.idealLatencyMs || 1000), Number(options.maxLatencyMs || 10000));
  const approvalRate = ratio(scoped, r => r.decision === 'ASK') * 100;
  const blockedRate = ratio(scoped, r => r.decision === 'BLOCK') * 100;
  const controlFriction = clamp(100 - (approvalRate * 0.5) - (blockedRate * 2), 0, 100);
  const successful = scoped.filter(r => r.executed && !r.error && !r.egressBlocked);
  const successfulTaskIds = new Set(successful.map(r => taskIdOf(r)));
  const taskCost = new Map();
  for (const r of successful) taskCost.set(taskIdOf(r), (taskCost.get(taskIdOf(r)) || 0) + Number(r.cost?.total || 0));
  const totalCost = [...taskCost.values()].reduce((s,r)=>s+r,0);
  const costPerSuccess = successfulTaskIds.size ? totalCost / successfulTaskIds.size : 0;
  const peerCosts = (runs || []).filter(r => r.executed && !r.error && !r.egressBlocked).map(r => Number(r.cost?.total||0)).filter(Number.isFinite).sort((a,b)=>a-b);
  const peerMedian = peerCosts.length ? percentile(peerCosts, .5) : costPerSuccess;
  const costEfficiency = peerMedian > 0 ? clamp(100 * (peerMedian / Math.max(costPerSuccess, 0.000001)), 0, 100) : (costPerSuccess === 0 ? 100 : 50);
  const score = round(success*0.30 + reliability*0.20 + toolEconomy*0.15 + latencyScore*0.15 + controlFriction*0.10 + costEfficiency*0.10, 1);
  return {
    agent: agent || scoped[0]?.request?.agent || 'unknown',
    score,
    status: score >= 80 ? 'HEALTHY' : score >= 60 ? 'ATTENTION' : 'DEGRADED',
    breakdown: { success: round(success), reliability: round(reliability), toolEconomy: round(toolEconomy), latency: round(latencyScore), controlFriction: round(controlFriction), costEfficiency: round(costEfficiency) },
    metrics: { runs: scoped.length, successRate: round(success), successfulTasks: successfulTaskIds.size, avgToolCalls: round(taskCalls,2), p50LatencyMs: latencyP50, approvalRate: round(approvalRate), blockedRate: round(blockedRate), retryRate: round(ratio(scoped, r => Number(r.request?.retryCount || 0) > 0)*100), costPerSuccessfulTask: roundMoney(costPerSuccess) }
  };
}

export function analyzeAgentEfficiency(runs = [], options = {}) {
  const agents = [...new Set(runs.map(r => r.request?.agent || 'unknown'))];
  const byAgent = Object.fromEntries(agents.map(agent => [agent, calculateAgentEfficiency(runs, agent, options)]));
  return { byAgent, overall: calculateAgentEfficiency(runs, null, options) };
}

/** Forecast uses deterministic month-to-date daily run-rate; no probabilistic model. */
export function forecastCost(runs = [], options = {}) {
  const now = options.now ? new Date(options.now) : new Date();
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const nextMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth()+1, 1));
  const daysInMonth = Math.round((nextMonth - monthStart) / 86400000);
  const elapsedDays = Math.max(1, Math.min(daysInMonth, Math.floor((now - monthStart) / 86400000) + 1));
  const monthly = runs.filter(r => new Date(r.createdAt || 0) >= monthStart).reduce((s,r)=>s+Number(r.cost?.total||0),0);
  const dailyRate = monthly / elapsedDays;
  const forecast = dailyRate * daysInMonth;
  const budget = Number(options.monthlyBudget || 0);
  return { currency: options.currency || 'USD', monthToDate: roundMoney(monthly), elapsedDays, daysInMonth, dailyRunRate: roundMoney(dailyRate), forecast: roundMoney(forecast), budget: budget > 0 ? budget : null, varianceVsBudget: budget > 0 ? roundMoney(forecast - budget) : null, method: 'month-to-date daily run-rate' };
}

/** Correlates behavior findings with cost, tool volume and security outcomes. */
export function correlateBehaviorCostSecurity(runs = [], behavior = null) {
  const report = behavior || analyzeBehavior(runs);
  const anomalyIds = new Set((report.findings || []).map(f => f.runId).filter(Boolean));
  const anomalous = runs.filter(r => anomalyIds.has(r.id));
  const normal = runs.filter(r => !anomalyIds.has(r.id));
  const cost = xs => xs.reduce((s,r)=>s+Number(r.cost?.total||0),0);
  const avg = (xs, fn) => xs.length ? fn(xs)/xs.length : 0;
  const toolRate = xs => xs.length;
  const blocked = anomalous.filter(r => r.decision === 'BLOCK').length;
  const asked = anomalous.filter(r => r.decision === 'ASK').length;
  const anomalyCost = cost(anomalous);
  const normalCost = cost(normal);
  return {
    anomalyRuns: anomalous.length,
    normalRuns: normal.length,
    anomalyCost: roundMoney(anomalyCost),
    normalCost: roundMoney(normalCost),
    avgAnomalyCost: roundMoney(avg(anomalous, cost)),
    avgNormalCost: roundMoney(avg(normal, cost)),
    costDeltaPercent: normalCost > 0 && anomalous.length ? round(((anomalyCost / anomalous.length) / Math.max(normalCost / Math.max(normal.length,1),0.000001) - 1) * 100) : null,
    blockedAnomalyRuns: blocked,
    approvalAnomalyRuns: asked,
    toolCallDelta: anomalous.length && normal.length ? round((toolRate(anomalous) / anomalous.length - toolRate(normal) / normal.length), 2) : null,
    securityCorrelation: {
      status: blocked > 0 || asked > 0 ? 'CONTROLLED_ANOMALY' : anomalous.length ? 'BEHAVIOR_ANOMALY' : 'NORMAL',
      findings: (report.findings || []).slice(0, 20).map(f => ({ id:f.id, title:f.title, risk:f.risk, runId:f.runId, agent:f.agent }))
    }
  };
}

export function analyzeCostAnalytics(runs = [], options = {}) {
  const group = (keyFn) => {
    const map = new Map();
    for (const r of runs) {
      const key = keyFn(r) || 'unknown';
      const x = map.get(key) || { runs:0, cost:0, blocked:0, approvals:0, errors:0, tokens:0 };
      x.runs++;
      x.cost += Number(r.cost?.total||0);
      x.blocked += r.decision === 'BLOCK' ? 1 : 0;
      x.approvals += r.decision === 'ASK' ? 1 : 0;
      x.errors += r.error ? 1 : 0;
      x.tokens += Number(r.cost?.usage?.totalTokens || 0);
      map.set(key,x);
    }
    return Object.fromEntries([...map].map(([k,v])=>[k,{...v,cost:roundMoney(v.cost),avgCost:roundMoney(v.cost/v.runs)}]));
  };
  const successful = runs.filter(r=>r.executed&&!r.error&&!r.egressBlocked);
  const securityCost = {
    blockedCalls: roundMoney(runs.filter(r=>r.decision==='BLOCK').reduce((s,r)=>s+Number(r.cost?.total||0),0)),
    approvalCalls: roundMoney(runs.filter(r=>r.decision==='ASK').reduce((s,r)=>s+Number(r.cost?.total||0),0)),
    attackTests: roundMoney(runs.filter(r=>r.request?.attackTest===true || r.attackTest===true).reduce((s,r)=>s+Number(r.cost?.total||0),0)),
    egressBlocks: roundMoney(runs.filter(r=>r.egressBlocked).reduce((s,r)=>s+Number(r.cost?.total||0),0))
  };
  return {
    byAgent: group(r=>r.request?.agent),
    byModel: group(r=>r.request?.model || r.cost?.model),
    byTool: group(r=>r.request?.tool || r.request?.action),
    byTenant: group(r=>r.tenantId),
    byCustomer: group(r=>r.request?.customerId || r.request?.userId || r.request?.identity?.userId),
    byAction: group(r=>r.request?.action || r.request?.tool),
    securityCost,
    successfulTaskCost: successful.length ? roundMoney(successful.reduce((s,r)=>s+Number(r.cost?.total||0),0)/successful.length) : 0,
    totalTokens: runs.reduce((s,r)=>s+Number(r.cost?.usage?.totalTokens||0),0),
    currency: options.currency || 'USD'
  };
}

export function createObservability(options = {}) {
  const pricing = new PricingRegistry(options.pricing || {});
  const costControl = options.costControl || new CostController({ budgets: options.budgets, maxEvents: options.maxCostEvents });
  const recordedRuns = new Set();
  function enrichRun(run = {}) {
    const usage = run.usage || run.request?.usage || null;
    const model = run.model || run.request?.model || usage?.model || null;
    const cost = calculateCost({ model, usage, price: run.price }, pricing.list());
    run.cost = { ...run.cost, ...cost };
    if (cost.known && run.id && !recordedRuns.has(run.id)) { costControl.record(run, cost); recordedRuns.add(run.id); }
    return run;
  }
  return {
    pricing,
    costControl,
    enrichRun,
    analyze: runs => analyzeObservability(runs, options),
    trace: run => buildUnifiedTrace(run),
    efficiency: (runs, opts) => analyzeAgentEfficiency(runs, opts || options.efficiency),
    forecast: (runs, opts) => forecastCost(runs, opts || options.forecast),
    correlation: runs => correlateBehaviorCostSecurity(runs),
    costAnalytics: (runs, opts) => analyzeCostAnalytics(runs, opts || {})
  };
}

function normalizePricingMap(input) { return Object.fromEntries(Object.entries(input || {}).map(([k,v]) => [k, normalizePrice(v)])); }
function normalizePrice(price = {}) { return { currency: price.currency || 'USD', inputPer1M: Number(price.inputPer1M ?? price.input ?? 0), outputPer1M: Number(price.outputPer1M ?? price.output ?? 0), cachedInputPer1M: Number(price.cachedInputPer1M ?? price.cachedInput ?? 0) }; }
function normalizeUsage(usage = {}) {
  const inputTokens = Number(usage.inputTokens ?? usage.promptTokens ?? usage.input_tokens ?? 0) || 0;
  const outputTokens = Number(usage.outputTokens ?? usage.completionTokens ?? usage.output_tokens ?? 0) || 0;
  const cachedInputTokens = Number(usage.cachedInputTokens ?? usage.cacheReadTokens ?? usage.cached_input_tokens ?? 0) || 0;
  return { inputTokens, outputTokens, cachedInputTokens, totalTokens: Number(usage.totalTokens ?? usage.total_tokens ?? inputTokens + outputTokens) || 0 };
}
function normalizeBudgets(input = {}) { const normalize = x => ({ ask: Math.max(0, Number(x?.ask ?? 0) || 0), hard: Math.max(0, Number(x?.hard ?? x?.block ?? 0) || 0) }); return { daily: normalize(input.daily), monthly: normalize(input.monthly) }; }
function remaining(limit, spent) { return limit > 0 ? roundMoney(Math.max(0, limit - spent)) : null; }
function countBy(items, fn) { return items.reduce((m, x) => { const k = fn(x); m[k] = (m[k] || 0) + 1; return m; }, {}); }
function groupStats(items, keyFn) {
  const map = new Map();
  for (const r of items) {
    const key = keyFn(r); const x = map.get(key) || { runs:0, blocked:0, asked:0, errors:0, cost:0, latency:[] };
    x.runs++; if (r.decision === 'BLOCK') x.blocked++; if (r.decision === 'ASK') x.asked++; if (r.error) x.errors++;
    x.cost += Number(r.cost?.total || 0); if (Number.isFinite(Number(r.durationMs))) x.latency.push(Number(r.durationMs)); map.set(key,x);
  }
  return Object.fromEntries([...map].map(([k,v])=>[k,{runs:v.runs,blocked:v.blocked,asked:v.asked,errors:v.errors,cost:roundMoney(v.cost),latency:percentileSummary(v.latency.sort((a,b)=>a-b))}]));
}
function percentileSummary(values) { if (!values.length) return {count:0,avgMs:0,p50:0,p95:0,p99:0,maxMs:0}; const sum=values.reduce((a,b)=>a+b,0); return {count:values.length,avgMs:round(sum/values.length,3),p50:percentile(values,.5),p95:percentile(values,.95),p99:percentile(values,.99),maxMs:values[values.length-1]}; }
function percentile(values,p) { const i=(values.length-1)*p,lo=Math.floor(i),hi=Math.ceil(i); return lo===hi?values[lo]:round(values[lo]+(values[hi]-values[lo])*(i-lo),3); }
function ratio(items,predicate){ return items.length ? items.filter(predicate).length/items.length : 0; }
function clamp(n,min,max){return Math.max(min,Math.min(max,n));}
function scoreLowerIsBetter(value,ideal,max){ if(!Number.isFinite(value)||value<=ideal)return 100; if(value>=max)return 0; return 100*(1-(value-ideal)/(max-ideal)); }
function taskIdOf(r){ return r.request?.context?.taskId || r.request?.taskId || r.request?.sessionId || r.id; }
function averageToolCallsPerTask(runs){
  const tasks=new Map();
  for(const r of runs){const id=taskIdOf(r); tasks.set(id,(tasks.get(id)||0)+1);}
  return tasks.size ? [...tasks.values()].reduce((a,b)=>a+b,0)/tasks.size : 0;
}
function round(n,d=2){const p=10**d;return Math.round((Number(n)||0)*p)/p;}
function roundMoney(n){return round(n,6);}
function structuredCloneSafe(v){try{return structuredClone(v);}catch{return JSON.parse(JSON.stringify(v));}}
