import test from 'node:test';
import assert from 'node:assert/strict';
import { authorize, normalizeIdentity } from '../src/identity.js';
import { evaluate } from '../src/policy-engine.js';
import { createAgentGate } from '../src/agentgate.js';
import { createMCPGateway } from '../src/mcp-gateway.js';
import { createControlPlane } from '../src/control-plane.js';

test('identity normalizes agent, user, roles and attributes', () => {
  const identity = normalizeIdentity({ agent: 'support-agent', userId: 'u1', roles: ['support'], attributes: { team: 'ops' } });
  assert.equal(identity.agentId, 'support-agent');
  assert.equal(identity.userId, 'u1');
  assert.deepEqual(identity.roles, ['support']);
  assert.equal(identity.attributes.team, 'ops');
});

test('RBAC allows a role-scoped action', () => {
  const result = authorize({ action: 'refund', identity: { agentId: 'billing-agent', roles: ['billing'] } }, {
    rules: [{ id: 'billing-refunds', effect: 'allow', roles: ['billing'], actions: ['refund'] }]
  });
  assert.equal(result.decision, 'ALLOW');
  assert.equal(result.matchedRule, 'billing-refunds');
});

test('deny-by-default blocks unmatched identity', () => {
  const result = authorize({ action: 'delete', identity: { agentId: 'support-agent', roles: ['support'] } }, {
    requireIdentity: true,
    rules: [{ id: 'billing-only', effect: 'allow', roles: ['billing'], actions: ['refund'] }]
  });
  assert.equal(result.decision, 'BLOCK');
  assert.match(result.reason, /deny by default/i);
});

test('explicit deny wins over an allow rule', () => {
  const result = authorize({ action: 'refund', resource: 'payments/live', identity: { roles: ['billing'] } }, {
    rules: [
      { id: 'deny-live', effect: 'deny', roles: ['billing'], resources: ['payments/live'] },
      { id: 'allow-refund', effect: 'allow', roles: ['billing'], actions: ['refund'] }
    ]
  });
  assert.equal(result.decision, 'BLOCK');
  assert.equal(result.matchedRule, 'deny-live');
});

test('ABAC matches identity attributes and environment', () => {
  const result = authorize({ action: 'deploy', environment: 'staging', identity: { roles: ['engineer'], attributes: { team: 'platform' } } }, {
    rules: [{ id: 'platform-staging', effect: 'allow', roles: ['engineer'], environments: ['staging'], attributes: { team: 'platform' }, actions: ['deploy'] }]
  });
  assert.equal(result.decision, 'ALLOW');
});

test('authorization is surfaced in deterministic policy evaluation', () => {
  const result = evaluate({ action: 'refund', identity: { roles: ['support'] } }, {
    authorization: { rules: [{ id: 'billing-only', effect: 'allow', roles: ['billing'], actions: ['refund'] }] }
  });
  assert.equal(result.decision, 'BLOCK');
  assert.equal(result.authorization.enforced, true);
});

test('AgentGate exposes identity and authorization helpers', () => {
  const gate = createAgentGate({ policies: { authorization: { rules: [{ id: 'read-support', effect: 'allow', roles: ['support'], actions: ['read'] }] } } });
  assert.equal(gate.identity({ roles: ['support'] }).roles[0], 'support');
  assert.equal(gate.authorize({ action: 'read', roles: ['support'] }).decision, 'ALLOW');
  assert.equal(gate.authorize({ action: 'delete', roles: ['support'] }).decision, 'BLOCK');
});

test('MCP gateway enforces authorization before tool execution', async () => {
  let called = false;
  const gateway = createMCPGateway({ policies: { authorization: { rules: [{ id: 'billing', effect: 'allow', roles: ['billing'], actions: ['refund'] }] } }, tools: [{ name: 'refund', handler: async () => { called = true; return 'ok'; } }] });
  const result = await gateway.handle({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'refund', arguments: {}, identity: { roles: ['support'] } } });
  assert.equal(result.result.isError, true);
  assert.equal(called, false);
  assert.equal(gateway.runs()[0].decision, 'BLOCK');
  assert.equal(gateway.runs()[0].reason.includes('deny'), true);
});

test('control plane authorization endpoint returns decision and matched rule', async () => {
  const { api } = createControlPlane({ policies: { authorization: { rules: [{ id: 'reader', effect: 'allow', roles: ['reader'], actions: ['read'] }] } } });
  const result = await api('/api/authorize', 'POST', { action: 'read', identity: { roles: ['reader'] } });
  assert.equal(result.authorization.decision, 'ALLOW');
  assert.equal(result.authorization.matchedRule, 'reader');
});
