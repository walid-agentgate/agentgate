Release: AgentGate 2.14.2
Decision: READY FOR LIMITED REAL-WORLD TRIAL (carries forward the 2.14.1 decision)
Approved by: project team (Walid)
Date: 2026-10-03

Scope of this release: release-engineering consistency fixes only, found by an independent review that checked out the repository on a plain Linux environment —
- stale "v2.13.8" version text in README.md / standalone.html corrected
- npm run release:check no longer hardcodes a 2.13.x-only version regex
- three test files no longer hardcode /tmp/... paths (now use os.tmpdir()/fs.mkdtempSync), fixing portability to any environment without a pre-existing world-writable /tmp

No src/ runtime, security, or policy behavior changed. The trial scope, conditions, and known limitations from docs/assurance/agentgate-2.14.1/RELEASE-DECISION.md all carry forward unchanged.

P0 open issues: 0
P1 open issues: 0
Known limitations: see docs/known-limitations.md (now 9 items — 4 original plus 5 clarifying items recorded this release: Attack Lab is a verification tool not a guarantee, protection depends on correct tool registration, load numbers aren't a production SLA, and backup/incident-response remain the operator's responsibility, plus the npm-package-excludes-tests item carried from 2.14.1).
