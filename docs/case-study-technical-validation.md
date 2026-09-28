# AgentGate Technical Validation — 2.13.0

> This is a technical validation report, not a customer case study. It must not be presented as customer evidence.

> The 2.13.6 release retains this validated runtime baseline and adds first-client hardening; this document describes the historical 2.13.0 validation evidence.

## Scope
AgentGate 2.13.0 was tested from an independent consumer project using a real npm tarball, without relying on the package source tree.

## Results
- Design Partner workflow: 19/19 checks passed.
- Three Policy Packs were discoverable and contained policies/test cases.
- Shadow mode recorded proposed decisions and mismatch/readiness fields.
- ASK produced zero pre-approval executions; approved ASK executed exactly once.
- Live, Run and Replay evidence matched on `winningRule` and `ruleTrace`.
- Restart preserved blocked Run and Replay evidence.
- Cross-tenant access returned 403.
- Egress controls blocked raw credentials and applied configured redaction.
- 10,000 concurrent destructive attempts produced 10,000 BLOCK decisions and zero executions.

## What this proves
The tested runtime control boundary can be demonstrated with deterministic evidence. It does not prove that AgentGate prevents every AI security failure, replaces IAM, or provides legal/compliance certification.

## Customer case study policy
A customer case study must only be published after a real partner has completed Shadow → Enforce and approved publication of the relevant metrics and quotes.
