import { createAgentGate, getPolicyPack } from 'agentgate-runtime-control';

const pack = getPolicyPack('support-refund-safety');

export const agentgate = createAgentGate({
  agent: 'SupportAgent',
  mode: 'enforce',
  policies: pack.policies
});

export { pack };
