import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeBehavior, calculateBlastRadius, analyzeBlastRadius } from '../src/behavior.js';

const run = (id, action, decision='ALLOW', extra={}) => ({
  id, createdAt: new Date(Date.now() + Number(id.slice(1)) * 1000).toISOString(),
  decision, risk: 70, request: { agent:'DemoAgent', action, tool:action, environment:'production', ...extra }
});

test('behavior detects suspicious tool chaining and repeated control', () => {
  const runs = [
    run('r1','read','ALLOW'),
    run('r2','delete','BLOCK'),
    run('r3','publish','ASK'),
    run('r4','update_production','BLOCK')
  ];
  const result = analyzeBehavior(runs);
  assert.ok(result.findings.some(x => x.id === 'behavior.tool-chain-risk'));
  assert.ok(result.findings.some(x => x.id === 'behavior.escalation-pattern'));
  assert.ok(result.findings.some(x => x.id === 'behavior.repeated-control'));
  assert.equal(result.agents[0], 'DemoAgent');
});

test('blast radius is deterministic and explains factors', () => {
  const result = calculateBlastRadius(run('r1','export_all','BLOCK', { scope:'all', context:{ scope:'all', targetCount:20 } }));
  assert.equal(result.score, 100);
  assert.equal(result.level, 'critical');
  assert.ok(result.factors.includes('scope:all'));
  assert.ok(result.factors.includes('data-export'));
  assert.match(result.note, /not a guarantee/);
});

test('blast radius analysis summarizes runs', () => {
  const result = analyzeBlastRadius([run('r1','read'), run('r2','delete','BLOCK')]);
  assert.equal(result.runCount, 2);
  assert.ok(result.maxScore >= 55);
});
