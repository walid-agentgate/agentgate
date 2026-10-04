# Release Checklist — AgentGate 2.14.4 (checked copy)

This release fixes a real bug in `src/policy-registry.js` (policy listing) plus minor dashboard clarity follow-ons. Every item below carries over unchanged from `docs/assurance/agentgate-2.14.3/release-checklist.md` except where noted.

## Automated gate

- [x] `npm test` is green (195 tests, 193 passing; same 2 known Chromium-only failures, unrelated — 1 new regression test added for this fix).
- [x] `npm run release:check` is green — all 13 checks pass, including "standalone JS syntax."
- [x] All items from `docs/assurance/agentgate-2.14.3/release-checklist.md` automated gate still apply unchanged.

## Bug fix verified this release

- [x] `PolicyRegistry.list()`/`#versions()` now treats a missing `name` as "match all," so `GET /api/policies` (no `name` query param) returns every policy instead of an empty array.
- [x] Regression test added: `test/policy-registry.test.js` — "list() with no name returns every policy, not an empty list."
- [x] Confirmed `PolicyBundleRegistry.list()` (the sibling registry for policy bundles) already handled this correctly — it was not affected by this bug and needed no change.
- [x] Policy-name input placeholder reworded to avoid looking like a pre-filled value.
- [x] Behavior and Blast Radius sections: added inline clarifying text alongside the header-level notes from 2.14.3.

## Operational / assurance gate

Unchanged from `docs/assurance/agentgate-2.14.3/release-checklist.md` — no new operational or assurance-gate work was in scope for this release.

## Conclusion

2.14.4 fixes a real, previously-undetected bug (present since 2.14.1) where the dashboard's "list all policies" call never returned anything, making every created policy draft look like it had vanished. The fix is narrowly scoped, regression-tested, and does not change policy evaluation or any ALLOW/ASK/BLOCK decision logic. The known limitations recorded for 2.14.1–2.14.3 still apply and are unaffected.
