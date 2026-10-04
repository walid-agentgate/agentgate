import test from 'node:test';
import assert from 'node:assert/strict';
import { protect, PostgresStoreAdapter } from '../src/index.js';

// Regression test for the "New here? Pick a starting point" guided-setup
// buttons added to the Overview tab in standalone.html (gsProtect / gsPg
// handlers). Those buttons show a short code sample in a read-only
// textarea. The first version of this feature invented two APIs that don't
// exist (`agentgate.registerTool()` on a createAgentGate() instance, and
// `createPostgresAdapter()` as a subpath export) — exactly the same class
// of bug as the dashboard's "New policy" example (see
// dashboard-policy-example.test.js). This test keeps the two samples
// honest against the real package root exports. If you change the text in
// either modal, update this test to match (and vice versa).

test('"Protect my first tool" guided-setup sample runs against the real protect() export', async () => {
  const doRealRefund = async (input) => ({ refunded: input.amount });
  const refund = protect(doRealRefund, {
    action: 'refund',
    approvalActions: ['refund'],
    autoApproveAmount: 500,
    approvalAmount: 5000
  });
  const result = await refund({ action: 'refund', amount: 1200 });
  assert.equal(result.status, 'approval_required', 'the modal claims this call returns { status: "approval_required" }');
});

test('"Set up PostgreSQL staging" guided-setup sample constructs against the real PostgresStoreAdapter export', () => {
  const client = { query: async () => ({ rows: [] }) };
  assert.doesNotThrow(() => new PostgresStoreAdapter({ client }));
});
