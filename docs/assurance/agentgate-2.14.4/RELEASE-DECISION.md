Release: AgentGate 2.14.4
Decision: READY FOR LIMITED REAL-WORLD TRIAL (carries forward the 2.14.1 decision)
Approved by: project team (Walid)
Date: 2026-10-04

Scope of this release: a real bug fix, found by a second colleague trial of the live `agentgate dev` dashboard —
- `GET /api/policies` ("list all policies") always returned an empty array, so a successfully created policy draft never appeared in the dashboard's policy list, even though it was saved correctly to disk. Fixed in `src/policy-registry.js`. Present since 2.14.1; now covered by a regression test.
- Minor follow-on UX clarity fixes: policy-name placeholder wording, inline Behavior/Blast Radius explanations.

This is the first fix in this series that touches actual control-plane logic (policy listing), not just dashboard labeling — but the fix is narrowly scoped to the `list()`/`#versions()` filter in the policy registry and does not change policy evaluation, ALLOW/ASK/BLOCK decisions, persistence format, or any other registry (PolicyBundleRegistry already worked correctly and is unaffected).

P0 open issues: 0
P1 open issues: 0
Known limitations: see docs/known-limitations.md (unchanged at 9 items).
