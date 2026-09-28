import { protect } from 'agentgate-runtime-control';

const refund = protect(
  async ({ amount, customerId }) => ({ refunded: amount, customerId }),
  { autoApproveAmount: 500, approvalAmount: 5000, requireApprovalForDestructive: false }
);

console.log(await refund({ amount: 250, customerId: 'cus_123' })); // executed
console.log(await refund({ amount: 1200, customerId: 'cus_123' })); // approval_required
try {
  await refund({ amount: 9000, customerId: 'cus_123' });
} catch (error) {
  console.log({ status: 'blocked', decision: error.agentgate.decision, reason: error.agentgate.reason });
}
