Release: AgentGate 2.14.3
Decision: READY FOR LIMITED REAL-WORLD TRIAL (carries forward the 2.14.1 decision)
Approved by: project team (Walid)
Date: 2026-10-04

Scope of this release: dashboard UX/labeling fixes only, found by a colleague's hands-on trial of the live `agentgate dev` dashboard (standalone.html) —
- native browser `prompt()` dialogs for policy creation/testing replaced with an on-page modal form
- "● LIVE" badges and differentiation notes added to Behavior, Blast Radius, and Replay sections
- Monitor header and approval toast now state that demo tool handlers are no-ops
- Cost Control shows a clear "not configured" message instead of misleading `$0` tiles

No src/ runtime, security, or policy behavior changed. The trial scope, conditions, and known limitations from docs/assurance/agentgate-2.14.1/RELEASE-DECISION.md all carry forward unchanged.

P0 open issues: 0
P1 open issues: 0
Known limitations: see docs/known-limitations.md (unchanged at 9 items — this release fixed UI/labeling issues, not a conceptual limitation).
