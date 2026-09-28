import { createAgentGate } from 'agentgate-runtime-control';

const gate = createAgentGate({
  agent: 'SupportAgent',
  mode: 'enforce',
  policies: { productionBlock: true, autoApproveAmount: 500, approvalAmount: 5000 }
});

const refund = gate.protect(
  async ({ amount, customerId }) => ({ refunded: amount, customerId }),
  { tool: 'refund', action: 'refund' }
);

for (const amount of [250, 1200]) {
  try {
    console.log(await refund({ amount, customerId: 'cus_123' }));
  } catch (error) {
    console.log({ status: 'blocked', code: error.code, decision: error.agentgate?.decision, reason: error.agentgate?.reason });
  }
}
