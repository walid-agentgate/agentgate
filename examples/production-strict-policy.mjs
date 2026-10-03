// Recommended production policy baseline for a limited real-world trial
// (see docs/validation-report.md). Use this with `agentgate attack --deep
// --config ./examples/production-strict-policy.mjs` to see it block every
// unrecognized/adversarial action name, or import `agentgate` directly in
// your own app.
import { createAgentGate } from '../src/agentgate.js';

export const agentgate = createAgentGate({
  mode: 'enforce',
  policies: {
    // Deny-by-default for any action name the policy engine doesn't
    // recognize, instead of the historical (backward-compatible) 'allow'.
    unknownActionPolicy: 'block',
    // Reject action names outside [a-z][a-z0-9_.:-]{0,63} — closes off
    // Unicode lookalikes, bidi overrides, fullwidth forms, etc. on top of
    // the unconditional unsafe-character block that's always on.
    strictActionNames: true,
    // Block (not just ask) destructive actions tagged for production.
    productionBlock: true
  }
});

// For every sensitive tool, register real metadata instead of trusting
// the caller-supplied action name alone:
//
// gateway.registerTool({
//   name: 'remove_customer',
//   actionClass: 'destructive',
//   requiresApproval: true,
//   environments: ['development', 'staging'],
//   handler: async (args) => { /* ... */ }
// });
