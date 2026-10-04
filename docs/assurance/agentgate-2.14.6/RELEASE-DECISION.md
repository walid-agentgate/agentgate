Release: AgentGate 2.14.6
Decision: READY FOR LIMITED REAL-WORLD TRIAL (carries forward the 2.14.1 decision)
Approved by: project team (Walid)
Date: 2026-10-04

Scope of this release: 6 fixes requested by an independent technical review (install → test → dashboard → Attack Lab → approval flow → Replay → Observability), rated 8.5/10 ready for a limited trial conditional on these:

1. Replay: added run history (search/select/export), not just the latest run.
2. Monitor: pending-approval payloads now masked by default (sensitive fields redacted, operational fields like amount stay visible), full payload behind "View details."
3. Observability: "Success" metric relabeled "Executed cleanly" with explanatory text that BLOCK/ASK are policy outcomes, not failures.
4. README/package.json version consistency now enforced by `release-check.mjs`, not just fixed by hand (third time this drifted).
5. Overview gained a 3-option guided-setup block with code samples verified against the real package exports.
6. CSS overflow guards for long unbroken strings on some viewports.

Plus: clearer demo-data labeling, README subpath-export documentation, and docs/assurance/* excluded from the published npm package (now release-check-gated).

No policy-evaluation or decision logic changed — this is dashboard UX/documentation/release-tooling work.

P0 open issues: 0
P1 open issues: 0
Known limitations: see docs/known-limitations.md (unchanged at 9 items).
