# Release Checklist — AgentGate 2.14.5 (checked copy)

This release fixes a wrong example policy shape in the dashboard's "New policy" modal, plus a stale hardcoded version tag. Every item below carries over unchanged from `docs/assurance/agentgate-2.14.4/release-checklist.md` except where noted.

## Automated gate

- [x] `npm test` is green (196 tests, 194 passing; same 2 known Chromium-only failures, unrelated — 1 new regression test added).
- [x] `npm run release:check` is green — all 13 checks pass, including "standalone JS syntax."
- [x] All items from `docs/assurance/agentgate-2.14.4/release-checklist.md` automated gate still apply unchanged.

## Bug fix verified this release

- [x] "New policy" example changed from `{refund:{max:5000}}` (never read by the engine) to `{autoApproveAmount:500, approvalAmount:5000, requireApprovalForDestructive:false}` (the real, documented shape).
- [x] Verified directly against `evaluate()`: amount 100 → `ALLOW`, amount 1000 → `ASK`, amount 6000 → `BLOCK` — matches the pre-filled "Test policy" example cases exactly.
- [x] Regression test added: `test/dashboard-policy-example.test.js` — extracts both examples from `standalone.html` and checks them together against the real engine.
- [x] Dashboard sidebar version tag now fetches `/api/health` at load instead of hardcoding a version string.

## Operational / assurance gate

Unchanged from `docs/assurance/agentgate-2.14.4/release-checklist.md` — no new operational or assurance-gate work was in scope for this release.

## Conclusion

2.14.5 fixes the third real issue found across this colleague's three trial rounds: an example policy in the dashboard that silently did nothing because it didn't match the engine's actual schema. The underlying policy-evaluation logic was already correct and untouched — only the dashboard's own example and version display changed. The known limitations recorded for 2.14.1–2.14.4 still apply and are unaffected.
