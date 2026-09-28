import { createRuntime, runAttackLab } from 'agentgate-runtime-control';

const gate = createRuntime({ mode: 'enforce', policies: { productionBlock: true, approvalAmount: 5000, autoApproveAmount: 500 } });
const charge = async ({ amount }) => ({ charged: amount });

try {
  console.log(await gate.execute(charge, { action: 'refund', amount: 120 }));
} catch (error) {
  console.log({ status: 'blocked', code: error.code, decision: error.agentgate?.decision, reason: error.agentgate?.reason });
}
console.log(gate.runs());
console.table(runAttackLab({ productionBlock: true }));
