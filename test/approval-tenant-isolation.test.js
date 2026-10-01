import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createMCPGateway } from '../src/mcp-gateway.js';
import { createControlPlane } from '../src/control-plane.js';
import { TenantRegistry } from '../src/multi-tenant.js';

// These exercise the exact questions a security reviewer asked about the
// Control Plane: can tenant A see, approve, or deny tenant B's approvals,
// with real HTTP requests and real issued API keys (not just direct
// function calls on the runtime object).

function tmpDir() { return fs.mkdtempSync(path.join(os.tmpdir(), 'agentgate-tenant-')); }

async function startServer(cp) {
  const server = cp.server.listen(0);
  await new Promise(resolve => server.once('listening', resolve));
  return { server, port: server.address().port };
}

async function call(port, apiPath, { method = 'GET', key } = {}) {
  const res = await fetch(`http://127.0.0.1:${port}${apiPath}`, {
    method,
    headers: key ? { 'x-agentgate-key': key, 'content-type': 'application/json' } : { 'content-type': 'application/json' },
    body: method === 'POST' ? '{}' : undefined
  });
  let json = null;
  try { json = await res.json(); } catch { /* no body */ }
  return { status: res.status, json };
}

test('a request with no API key is rejected when auth is required', async () => {
  const dir = tmpDir();
  const gateway = createMCPGateway({ persistence: dir, tools: [{ name: 'refund', handler: async () => 'ok' }] });
  const cp = createControlPlane({ gateway, persistence: dir, authRequired: true });
  const { server, port } = await startServer(cp);
  const result = await call(port, '/api/approvals');
  assert.equal(result.status, 401);
  server.close();
});

test('tenant A cannot see, approve, or deny tenant B\'s approval — over real HTTP with real API keys', async () => {
  const dir = tmpDir();
  const tenants = new TenantRegistry({ filePath: path.join(dir, 'tenants.json'), keyPath: path.join(dir, 'api-keys.json') });
  const tenantA = tenants.create('tenant-a');
  const tenantB = tenants.create('tenant-b');
  const keyA = tenants.issueKey(tenantA.id, { scopes: ['approvals:read', 'approvals:resolve'] }).secret;
  const keyB = tenants.issueKey(tenantB.id, { scopes: ['approvals:read', 'approvals:resolve'] }).secret;

  const gateway = createMCPGateway({
    persistence: dir,
    tools: [{ name: 'refund', handler: async (input) => ({ refunded: input.amount }) }]
  });
  const cp = createControlPlane({ gateway, persistence: dir, tenantRegistry: tenants, authRequired: true });
  const { server, port } = await startServer(cp);

  // Tenant B creates its own approval directly on the gateway (as if its own
  // agent had triggered it) so we have a real approvalId to attack.
  const created = await gateway.handle({
    jsonrpc: '2.0', id: 1, method: 'tools/call',
    params: { name: 'refund', arguments: { amount: 900 }, action: 'refund', tenantId: tenantB.id }
  });
  const approvalId = created.result._agentgate.approvalId;

  // Tenant A's own list must never include tenant B's approval.
  const listAsA = await call(port, '/api/approvals', { key: keyA });
  assert.equal(listAsA.status, 200);
  assert.ok(!listAsA.json.approvals.some(a => a.id === approvalId), 'tenant A must not see tenant B\'s approval in its own list');

  // Tenant B sees its own approval fine.
  const listAsB = await call(port, '/api/approvals', { key: keyB });
  assert.ok(listAsB.json.approvals.some(a => a.id === approvalId));

  // Tenant A tries to approve tenant B's approval by id directly.
  const approveAttempt = await fetch(`http://127.0.0.1:${port}/api/approvals/approve`, {
    method: 'POST',
    headers: { 'x-agentgate-key': keyA, 'content-type': 'application/json' },
    body: JSON.stringify({ approvalId })
  });
  const approveJson = await approveAttempt.json();
  assert.notEqual(approveJson.ok, true);
  assert.equal(gateway.getApproval(approvalId).status, 'pending', 'cross-tenant approve must not have taken effect');

  // Tenant A tries to deny it too.
  const denyAttempt = await fetch(`http://127.0.0.1:${port}/api/approvals/deny`, {
    method: 'POST',
    headers: { 'x-agentgate-key': keyA, 'content-type': 'application/json' },
    body: JSON.stringify({ approvalId, reason: 'attacker-controlled' })
  });
  const denyJson = await denyAttempt.json();
  assert.notEqual(denyJson.ok, true);
  assert.equal(gateway.getApproval(approvalId).status, 'pending');

  // Tenant B (the rightful owner) can resolve its own approval.
  const legitimateApprove = await fetch(`http://127.0.0.1:${port}/api/approvals/approve`, {
    method: 'POST',
    headers: { 'x-agentgate-key': keyB, 'content-type': 'application/json' },
    body: JSON.stringify({ approvalId })
  });
  const legitimateJson = await legitimateApprove.json();
  assert.equal(legitimateJson.ok, true);
  assert.equal(legitimateJson.status, 'executed');

  server.close();
});

test('cross-tenant isolation still holds after a restart', async () => {
  const dir = tmpDir();
  const tenants = new TenantRegistry({ filePath: path.join(dir, 'tenants.json'), keyPath: path.join(dir, 'api-keys.json') });
  const tenantA = tenants.create('tenant-a');
  const tenantB = tenants.create('tenant-b');
  const keyA = tenants.issueKey(tenantA.id, { scopes: ['approvals:read', 'approvals:resolve'] }).secret;

  const tools = [{ name: 'delete', handler: async () => ({ ok: true }) }];
  const gatewayBefore = createMCPGateway({ persistence: dir, tools });
  const created = await gatewayBefore.handle({
    jsonrpc: '2.0', id: 2, method: 'tools/call',
    params: { name: 'delete', arguments: { id: 'x' }, action: 'delete', tenantId: tenantB.id }
  });
  const approvalId = created.result._agentgate.approvalId;

  // --- restart: fresh gateway + fresh control plane over the same tenant registry / persistence dir ---
  const gatewayAfter = createMCPGateway({ persistence: dir, tools });
  const tenantsAfter = new TenantRegistry({ filePath: path.join(dir, 'tenants.json'), keyPath: path.join(dir, 'api-keys.json') });
  const cp = createControlPlane({ gateway: gatewayAfter, persistence: dir, tenantRegistry: tenantsAfter, authRequired: true });
  const { server, port } = await startServer(cp);

  const listAsA = await call(port, '/api/approvals', { key: keyA });
  assert.ok(!listAsA.json.approvals.some(a => a.id === approvalId), 'isolation must still hold after restart');

  server.close();
});
