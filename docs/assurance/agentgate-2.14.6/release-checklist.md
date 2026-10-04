# Release Checklist — AgentGate 2.14.6 (checked copy)

This release implements all 6 fixes requested by an independent technical review, plus 3 smaller related items. Every item below carries over unchanged from `docs/assurance/agentgate-2.14.5/release-checklist.md` except where noted.

## Automated gate

- [x] `npm test` is green (200 tests, 198 passing; same 2 known Chromium-only failures, unrelated — 4 new regression tests added).
- [x] `npm run release:check` is green — 14 checks pass (1 new check added this release: README/package.json version agreement).
- [x] All items from `docs/assurance/agentgate-2.14.5/release-checklist.md` automated gate still apply unchanged.

## Fixes verified this release

- [x] Replay: searchable run history (by ID/tool/action/decision), select any run to view its trace, export selected run as JSON.
- [x] Monitor: pending approvals show a readable summary by default; full payload behind "View details" with sensitive fields (customerId, email, token, card, etc.) masked via `maskSensitive()`; operational fields (action, amount) stay visible. Regression-tested in `test/dashboard-payload-masking.test.js`.
- [x] Observability: "Success" → "Executed cleanly," "Blocked"/"Approvals" labeled as protective outcomes; explanatory line added.
- [x] README.md updated to v2.14.6; `release-check.mjs` now has a permanent "README version matches package.json" gate.
- [x] Overview: 3-button guided-setup block ("Try the Demo," "Protect my first tool," "Set up PostgreSQL staging"). Code samples verified by hand-running them against the real package exports before shipping (an earlier draft invented `agentgate.registerTool()` on a `createAgentGate()` instance and a non-existent `createPostgresAdapter` subpath — caught and fixed before release). Regression-tested in `test/dashboard-guided-setup.test.js`.
- [x] CSS: `overflow-wrap`/`min-width:0`/`max-width:100%` guards added; verified `standalone JS syntax` check still passes.
- [x] Overview demo stats: added explicit "Demo/sample metrics ... not your environment's real telemetry" text.
- [x] README: documented subpath exports (most things from package root; `createControlPlane`/`PolicyRegistry`/etc. are subpaths).
- [x] `package.json` `files` field excludes `docs/assurance/*` from the published npm package; `release-check.mjs` guards this with a new check.

## Operational / assurance gate

Unchanged from `docs/assurance/agentgate-2.14.5/release-checklist.md` — no new operational or assurance-gate work was in scope for this release.

## Conclusion

2.14.6 closes all 6 fixes an independent technical review asked for before further real-world trial, plus 3 related documentation/packaging items from the same review. No policy-evaluation or decision logic changed — this release is dashboard UX, documentation, and release-tooling work, each piece verified against the real running code before shipping (not just written and assumed correct, learning from three earlier releases where an unverified example turned out to be wrong). The known limitations recorded for 2.14.1–2.14.5 still apply and are unaffected.
