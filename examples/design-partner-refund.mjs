import { createAgentGate, getPolicyPack } from 'agentgate-runtime-control';

const pack = getPolicyPack('support-refund-safety');
const gate = createAgentGate({
  agent: 'SupportAgent',
  mode: 'observe',
  policies: pack.policies
});

let executions = 0;
const refund = gate.protect(
  async ({ amount, customerId }) => {
    executions += 1;
    return { refunded: amount, customerId };
  },
  { tool: 'refund', action: 'refund' }
);

for (const amount of [250, 1200, 5000.01]) {
  const result = await refund(
    { amount, customerId: 'sandbox_customer' },
    { amount, environment: 'production' }
  );
  console.log({
    amount,
    proposedDecision: result.agentgate.decision,
    winningRule: result.agentgate.winningRule,
    simulated: result.agentgate.simulated,
    handlerExecuted: result.status === 'executed'
  });
}

console.log({ mode: gate.mode, executions, note: 'Observe mode records proposed decisions and intentionally does not enforce them.' });
