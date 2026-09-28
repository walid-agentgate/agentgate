import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { evaluate } from '../src/policy-engine.js';
import { createControlPlane } from '../src/control-plane.js';
import { createMCPGateway } from '../src/mcp-gateway.js';

test('2.10.1 policy decisions expose a deterministic winning rule', () => {
  const low = evaluate({ action: 'refund', amount: 250 }, { autoApproveAmount: 500, approvalAmount: 5000, requireApprovalForDestructive: false });
  const mid = evaluate({ action: 'refund', amount: 1200 }, { autoApproveAmount: 500, approvalAmount: 5000, requireApprovalForDestructive: false });
  const high = evaluate({ action: 'refund', amount: 9000 }, { autoApproveAmount: 500, approvalAmount: 5000, requireApprovalForDestructive: false });
  assert.equal(low.decision, 'ALLOW');
  assert.equal(low.winningRule, 'default-allow');
  assert.equal(mid.decision, 'ASK');
  assert.equal(mid.winningRule, 'auto-approval-threshold');
  assert.equal(high.decision, 'BLOCK');
  assert.equal(high.winningRule, 'approval-amount-hard');
  assert.ok(Array.isArray(high.ruleTrace));
});

test('2.10.1 local dashboard session grants browser access without weakening production auth', async () => {
  const gateway = createMCPGateway({ tools: [{ name: 'read', handler: async () => ({ ok: true }) }] });
  const html = '<!doctype html><html><body>AgentGate</body></html>';
  const { server } = createControlPlane({ gateway, html, localDevSession: true });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  try {
    const root = await fetch(`http://127.0.0.1:${port}/`);
    assert.equal(root.status, 200);
    const cookie = root.headers.get('set-cookie');
    assert.match(cookie || '', /agentgate_local_session=/);
    const runsWithout = await fetch(`http://127.0.0.1:${port}/api/runs`);
    assert.equal(runsWithout.status, 401);
    const runsWith = await fetch(`http://127.0.0.1:${port}/api/runs`, { headers: { cookie: cookie.split(';')[0] } });
    assert.equal(runsWith.status, 200);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});
