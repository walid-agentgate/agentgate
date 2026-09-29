// Protect your first real tool with AgentGate.
//
// The flow AgentGate sits in:
//
//   AI Agent  ─────▶  AgentGate  ─────▶  Tool / API  ─────▶  External system
//                     (ALLOW/ASK/BLOCK
//                      decided here,
//                      BEFORE the tool
//                      handler runs)
//
// This example wraps four tools an agent might call and shows the
// decision each one gets under a simple, realistic policy:
//
//   read_customer   -> ALLOW  (read-only, no side effects)
//   delete_customer -> ASK    (destructive, always needs a human to approve)
//   refund          -> ASK below $5,000, BLOCK above $5,000
//   export_all      -> BLOCK  (bulk data export, always blocked)
//
// Note that "destructive" tools (delete, refund, publish, export_all,
// update_production, deploy) always require at least ASK — there is no
// amount small enough to skip approval entirely for them. That is
// deliberate: this policy engine treats "asks for approval" as the safe
// default for anything with a side effect, not just anything expensive.
//
// Run it with:
//   node examples/protect-first-tool.mjs

import { createAgentGate } from 'agentgate-runtime-control';

const gate = createAgentGate({
  agent: 'SupportAgent',
  mode: 'enforce',
  policies: {
    productionBlock: true,       // in production, destructive actions are blocked outright (not even ASK)
    approvalAmount: 5000,        // refunds above this amount are always BLOCKed, no approval possible
    blockActions: ['export_all'] // export_all is blocked regardless of amount/environment
  }
});

// --- The real tool handlers your agent would otherwise call directly ---
async function readCustomer({ customerId }) {
  return { customerId, name: 'Jane Doe', plan: 'pro' };
}
async function deleteCustomer({ customerId }) {
  return { deleted: customerId };
}
async function refund({ amount, customerId }) {
  return { refunded: amount, customerId };
}
async function exportAll() {
  return { exportedRows: 1_000_000 };
}

// --- Wrap each one with agentgate.protect() before the agent ever sees it ---
const protectedReadCustomer = gate.protect(readCustomer, { tool: 'read_customer', action: 'read' });
const protectedDeleteCustomer = gate.protect(deleteCustomer, { tool: 'delete_customer', action: 'delete' });
const protectedRefund = gate.protect(refund, { tool: 'refund', action: 'refund' });
const protectedExportAll = gate.protect(exportAll, { tool: 'export_all', action: 'export_all' });

async function tryCall(label, fn, input) {
  try {
    const result = await fn(input, input);
    console.log(`${label.padEnd(24)} -> ${result.status.toUpperCase()} (${result.agentgate.decision}) — ${result.agentgate.reason}`);
  } catch (error) {
    console.log(`${label.padEnd(24)} -> BLOCKED (${error.agentgate?.decision}) — ${error.agentgate?.reason}`);
  }
}

// environment: 'development' lets the amount/action-based rules below decide
// (ASK vs ALLOW vs BLOCK). In production, productionBlock:true would block
// every destructive action outright — try changing this to 'production' and
// re-running to see that stricter behavior.
const env = 'development';

console.log('AgentGate — protecting four real tools\n');
await tryCall('read_customer', protectedReadCustomer, { customerId: 'cus_123', environment: env });
await tryCall('delete_customer', protectedDeleteCustomer, { customerId: 'cus_123', environment: env });
await tryCall('refund (small)', protectedRefund, { amount: 250, customerId: 'cus_123', environment: env });
await tryCall('refund (large)', protectedRefund, { amount: 8000, customerId: 'cus_123', environment: env });
await tryCall('export_all', protectedExportAll, { environment: env });

console.log('\nNothing above BLOCK or pending ASK ever reached its real handler.');
console.log('See gate.approvals() to review and approve pending ASK requests.');
