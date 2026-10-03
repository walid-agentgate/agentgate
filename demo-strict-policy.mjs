import { createAgentGate } from './src/agentgate.js';

export const agentgate = createAgentGate({
  mode: 'enforce',
  policies: { unknownActionPolicy: 'block', strictActionNames: true, productionBlock: true }
});
