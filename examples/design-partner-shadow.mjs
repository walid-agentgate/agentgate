import { createAgentGate, getPolicyPack, recordShadowEvent, analyzeShadowEvents } from 'agentgate-runtime-control';

const pack = getPolicyPack('support-refund-safety');
const gate = createAgentGate({ agent: 'SupportAgent', mode: 'observe', policies: pack.policies });
const events = [];

async function refundTool({ amount, customerId }) {
  return { refunded: amount, customerId };
}

const refund = gate.protect(refundTool, { tool: 'refund', action: 'refund' });

for (const amount of [250, 1200, 5000.01]) {
  const result = await refund({ amount, customerId: 'sandbox_customer' }, { amount });
  events.push(recordShadowEvent({
    runId: result.agentgate.id,
    decision: result.agentgate.decision,
    executed: result.status === 'executed',
    request: result.agentgate.request
  }));
}

console.log(JSON.stringify({
  mode: gate.mode,
  shadow: analyzeShadowEvents(events),
  events
}, null, 2));
