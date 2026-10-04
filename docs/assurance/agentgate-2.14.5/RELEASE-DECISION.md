Release: AgentGate 2.14.5
Decision: READY FOR LIMITED REAL-WORLD TRIAL (carries forward the 2.14.1 decision)
Approved by: project team (Walid)
Date: 2026-10-04

Scope of this release: a second real bug fix, found by the same colleague's third trial —
- The dashboard's "New policy" example policy used a shape (`{refund:{max:5000}}`) the policy engine never reads. Fixed to the real, documented policy shape (`approvalAmount`/`autoApproveAmount`/`requireApprovalForDestructive`), verified against the live engine, and now regression-tested against `standalone.html`'s own example content.
- The dashboard sidebar's version tag was hardcoded and had gone stale twice; it now reads the real version from `/api/health` at load time.

This fix touches only example/display content inside `standalone.html` — no policy-engine logic, decision rules, or evaluation order changed. The engine behavior this release verifies against was already correct and unchanged; only the dashboard's own example was wrong.

P0 open issues: 0
P1 open issues: 0
Known limitations: see docs/known-limitations.md (unchanged at 9 items).
