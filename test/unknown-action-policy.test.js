import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluate } from '../src/policy-engine.js';
import { validateAgentGateConfig, runDoctorChecks } from '../src/local-experience.js';
import { createMCPGateway } from '../src/mcp-gateway.js';

// A security review found that any action name AgentGate doesn't
// recognize (not in the small built-in destructive/read-only lists, and
// not named by an explicit policy) falls through to ALLOW. These tests
// lock in the fix: `unknownActionPolicy` controls that fallback, and its
// risky default is surfaced loudly rather than left silent.

test('an unrecognized action ALLOWs by default (documents the gap, for backward compatibility)', () => {
  for (const action of ['grant_admin', 'drop_database', 'transfer_money', 'read_secrets', 'modify_billing']) {
    const result = evaluate({ action }, {});
    assert.equal(result.decision, 'ALLOW', `${action} should still default-allow unless unknownActionPolicy is set`);
    assert.equal(result.winningRule, 'default-allow');
  }
});

test('unknownActionPolicy: "ask" holds unrecognized actions for approval', () => {
  const result = evaluate({ action: 'grant_admin' }, { unknownActionPolicy: 'ask' });
  assert.equal(result.decision, 'ASK');
  assert.equal(result.winningRule, 'unknown-action-ask');
});

test('unknownActionPolicy: "block" refuses unrecognized actions outright', () => {
  const result = evaluate({ action: 'drop_database' }, { unknownActionPolicy: 'block' });
  assert.equal(result.decision, 'BLOCK');
  assert.equal(result.winningRule, 'unknown-action-block');
});

test('unknownActionPolicy never overrides a more specific matching rule', () => {
  // A known destructive action still goes through its normal path even with
  // unknownActionPolicy set — the new rule only applies to the fallback.
  const ask = evaluate({ action: 'delete' }, { unknownActionPolicy: 'block' });
  assert.equal(ask.decision, 'ASK');
  assert.equal(ask.winningRule, 'destructive-approval');

  const readOnly = evaluate({ action: 'read' }, { unknownActionPolicy: 'block' });
  assert.equal(readOnly.decision, 'ALLOW');
  assert.equal(readOnly.winningRule, 'readonly-allow');

  const explicitAsk = evaluate({ action: 'weird_tool' }, { unknownActionPolicy: 'block', approvalActions: ['weird_tool'] });
  assert.equal(explicitAsk.decision, 'ASK');
  assert.equal(explicitAsk.winningRule, 'approval-action');
});

test('the unrecognized-action gap does not execute the real handler when unknownActionPolicy is set', async () => {
  let executed = false;
  const gateway = createMCPGateway({
    policies: { unknownActionPolicy: 'ask' },
    tools: [{ name: 'grant_admin', handler: async () => { executed = true; return { ok: true }; } }]
  });
  const result = await gateway.handle({
    jsonrpc: '2.0', id: 1, method: 'tools/call',
    params: { name: 'grant_admin', arguments: { userId: 'u1' }, action: 'grant_admin' }
  });
  assert.equal(result.result._agentgate.approvalRequired, true);
  assert.equal(executed, false);
});

test('validateAgentGateConfig warns when unknownActionPolicy is left at its default', () => {
  const defaulted = validateAgentGateConfig({ policies: {} });
  assert.ok(defaulted.warnings.some(w => w.includes('unknownActionPolicy')));

  const explicitAllow = validateAgentGateConfig({ policies: { unknownActionPolicy: 'allow' } });
  assert.ok(explicitAllow.warnings.some(w => w.includes('unknownActionPolicy')));

  const askSet = validateAgentGateConfig({ policies: { unknownActionPolicy: 'ask' } });
  assert.ok(!askSet.warnings.some(w => w.includes('unknownActionPolicy')));

  const blockSet = validateAgentGateConfig({ policies: { unknownActionPolicy: 'block' } });
  assert.ok(!blockSet.warnings.some(w => w.includes('unknownActionPolicy')));
});

test('runDoctorChecks surfaces the unknownActionPolicy warning end-to-end', () => {
  const report = runDoctorChecks({ config: { mode: 'enforce', policies: {} } });
  assert.ok(report.warnings.some(w => w.includes('unknownActionPolicy')));
});
