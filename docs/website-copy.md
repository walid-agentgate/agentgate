# AgentGate Website Copy — Launch Draft

## Hero
**Control what your AI agents can actually do.**

AgentGate is the runtime control plane for AI agent actions. Stop dangerous tool calls before they execute, require approval for sensitive actions, and keep replayable evidence of every decision.

**CTA:** Start with the SDK
**Secondary CTA:** Run the Attack Lab

## Proof strip
`ALLOW` · `ASK` · `BLOCK` · Approval boundaries · Egress protection · Tenant isolation · Replay

## How it works
**Install → Observe → Attack → Enforce → Replay**

AgentGate sits between your agent and its tools. The model can request an action; AgentGate makes the deterministic runtime decision.

## Why AgentGate
### Prevent side effects
A BLOCK decision happens before the protected handler executes.

### Make approvals real
Sensitive actions can pause for human approval. No pre-approval handler execution.

### Prove what happened
Every important decision can carry a winning rule, rule trace, execution outcome, and Replay evidence.

### Start without production risk
Use sandbox, replay traffic, and Shadow Mode before enforcing a sensitive tool.

## Use cases
- Support and financial operations: refunds, cancellations, customer changes.
- DevOps and IT: deployments, production changes, destructive operations.
- Data and CRM: exports, bulk updates, cross-tenant access.

## Security boundary
AgentGate is a runtime control layer. It does not replace application authorization, IAM, secret management, network isolation, provider controls, or threat modeling.

## CTA
**Give one agent one sensitive tool. See what AgentGate would allow, ask, and block.**

Install:
`npm install agentgate-runtime-control`
