import test from 'node:test';
import assert from 'node:assert/strict';
import { createEgressGuard, guardEgress, inspectEgress } from '../src/egress-guard.js';
import { createMCPGateway } from '../src/mcp-gateway.js';

test('egress guard allows clean data', () => {
  const result = guardEgress({ ok: true, message: 'hello world' });
  assert.equal(result.action, 'ALLOW');
  assert.equal(result.allowed, true);
});

test('egress guard redacts PII by default', () => {
  const result = guardEgress({ customer: 'alice@example.com' });
  assert.equal(result.action, 'REDACT');
  assert.equal(result.value.customer, '[REDACTED:EMAIL]');
});

test('egress guard blocks API keys', () => {
  const result = guardEgress({ token: 'sk-1234567890abcdef1234' });
  assert.equal(result.action, 'BLOCK');
  assert.equal(result.allowed, false);
  assert.match(result.value.token, /REDACTED/);
});


test('egress guard blocks generic secret fields', () => {
  const result = guardEgress({ secret: 'super-secret-value', nested: { password: 'p@ssw0rd' }, authorization: 'Bearer abc' });
  assert.equal(result.action, 'BLOCK');
  assert.equal(result.allowed, false);
  assert.equal(result.value.secret, '[REDACTED:SECRET]');
  assert.equal(result.value.nested.password, '[REDACTED:SECRET]');
  assert.equal(result.value.authorization, '[REDACTED:SECRET]');
  assert.ok(result.findings.filter(x => x.type === 'generic_secret').length >= 3);
});

test('inspect detects generic secret fields without exposing their values', () => {
  const result = inspectEgress({ secret: 'super-secret-value', private_key: 'PRIVATE-DATA' });
  assert.equal(result.action, 'BLOCK');
  assert.ok(result.findings.some(x => x.type === 'generic_secret'));
  assert.doesNotMatch(JSON.stringify(result), /super-secret-value/);
});
test('custom rules can redact instead of block', () => {
  const guard = createEgressGuard({ rules: { api_key: { action: 'REDACT', replacement: '[MASKED]' } } });
  const result = guard.guard('key=sk-1234567890abcdef1234');
  assert.equal(result.action, 'REDACT');
  assert.equal(result.value, 'key=[MASKED]');
});

test('inspect reports findings without mutating output', () => {
  const input = { email: 'bob@example.com' };
  const result = inspectEgress(input);
  assert.equal(result.action, 'REDACT');
  assert.equal(input.email, 'bob@example.com');
});

test('MCP runtime blocks sensitive egress', async () => {
  const gateway = createMCPGateway({
    egress: {},
    tools: [{ name: 'secret', handler: async () => ({ token: 'sk-1234567890abcdef1234' }) }]
  });
  const response = await gateway.handle({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'secret', arguments: {} } });
  assert.equal(response.result.isError, true);
  assert.match(response.result.content[0].text, /blocked data egress/i);
  assert.equal(response.result._agentgate.egress.action, 'BLOCK');
});

test('MCP runtime redacts sensitive egress', async () => {
  const gateway = createMCPGateway({
    egress: { rules: { api_key: { action: 'REDACT', replacement: '[MASKED]' } } },
    tools: [{ name: 'data', handler: async () => ({ token: 'sk-1234567890abcdef1234' }) }]
  });
  const response = await gateway.handle({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'data', arguments: {} } });
  assert.equal(response.result.isError, undefined);
  assert.match(response.result.content[0].text, /\[MASKED\]/);
  assert.doesNotMatch(response.result.content[0].text, /sk-123/);
});


test('approved tool output is still protected by egress guard', async () => {
  const gateway = createMCPGateway({
    egress: {},
    policies: { approvalActions: ['refund'] },
    tools: [{ name: 'refund', handler: async () => ({ token: 'sk-1234567890abcdef1234' }) }]
  });
  const pending = await gateway.handle({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'refund', arguments: { amount: 100 } } });
  const approvalId = pending.result._agentgate.approvalId;
  const resolved = await gateway.handle({ jsonrpc: '2.0', id: 2, method: 'agentgate/approvals/approve', params: { approvalId } });
  assert.equal(resolved.result.status, 'egress_blocked');
  assert.equal(resolved.result.run.egress.action, 'BLOCK');
});

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const execFileAsync = promisify(execFile);
test('CLI egress command reports strict violations', async () => {
  const fs = await import('node:fs/promises');
  const os = await import('node:os');
  const path = await import('node:path');
  const fsSync = await import('node:fs');
  const dir = fsSync.mkdtempSync(path.join(os.tmpdir(), 'agentgate-egress-'));
  const file = path.join(dir, 'agentgate-egress-test.json');
  await fs.writeFile(file, JSON.stringify({ token: 'sk-1234567890abcdef1234' }));
  await assert.rejects(async () => {
    await execFileAsync(process.execPath, ['bin/agentgate.js', 'egress', file, '--strict'], { cwd: new URL('..', import.meta.url).pathname });
  }, error => error?.code === 2);
});
