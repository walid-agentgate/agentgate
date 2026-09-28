import test from 'node:test';
import assert from 'node:assert/strict';
import { validateAgentGateConfig, simulatePolicyMatrix, runDoctorChecks, runSecurityValidation } from '../src/index.js';

test('2.11 config validation catches unsafe thresholds', () => {
  const bad = validateAgentGateConfig({ mode: 'enforce', policies: { autoApproveAmount: 9000, approvalAmount: 5000 } });
  assert.equal(bad.valid, false);
  assert.ok(bad.errors.some(x => x.includes('autoApproveAmount')));
});

test('2.11 policy simulation exposes deterministic decisions', () => {
  const rows = simulatePolicyMatrix({ policies: { productionBlock: true, autoApproveAmount: 500, approvalAmount: 5000 } });
  assert.deepEqual(rows.map(x => x.decision), ['ALLOW', 'BLOCK', 'BLOCK', 'BLOCK', 'BLOCK', 'BLOCK']);
  assert.ok(rows.every(x => x.winningRule));
});

test('2.11 doctor fails when gateway mode is invalid', () => {
  const report = runDoctorChecks({ config: { mode: 'enforce', authRequired: true }, gateway: { mode: 'broken', policies: {} } });
  assert.equal(report.ok, false);
});

test('2.12 security validation gate passes core invariants', async () => {
  const report = await runSecurityValidation();
  assert.equal(report.ok, true);
  assert.ok(report.checks.length >= 6);
  assert.ok(report.checks.every(x => x.ok));
});

test('2.12.2 MCP server version follows package version', async () => {
  const { createMCPGateway } = await import('../src/mcp-gateway.js');
  const gateway = createMCPGateway({ tools: [] });
  const response = await gateway.handle({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} });
  const { readFileSync } = await import('node:fs');
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  assert.equal(response.result.serverInfo.version, pkg.version);
});

test('2.12.2 retention status exposes configured limit and truncation state', async () => {
  const { createMCPGateway } = await import('../src/mcp-gateway.js');
  const gateway = createMCPGateway({ maxRuns: 10, policies: { productionBlock: true }, tools: [{ name: 'read', handler: async () => ({ ok: true }) }] });
  await gateway.handle({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'read', action: 'read', environment: 'development', arguments: {}, tenantId: 'A' } });
  const status = gateway.retention();
  assert.equal(status.limit, 10);
  assert.equal(status.truncated, false);
  assert.equal(status.nearLimit, false);
});

test('2.12.2 security validation proves real handler counter stays zero on BLOCK', async () => {
  const { runSecurityValidation } = await import('../src/security-validation.js');
  const report = await runSecurityValidation({ maxRuns: 2000 });
  const check = report.checks.find(x => x.name === 'pre-execution-block');
  assert.equal(check.ok, true);
  assert.equal(check.details.handlerExecuted, false);
});
