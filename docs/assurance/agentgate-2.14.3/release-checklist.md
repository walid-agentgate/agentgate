# Release Checklist — AgentGate 2.14.3 (checked copy)

This release is scoped to dashboard UX/labeling fixes only (`standalone.html`). Every item below carries over unchanged from `docs/assurance/agentgate-2.14.2/release-checklist.md` except where noted.

## Automated gate

- [x] `npm test` is green (192/194; same 2 known Chromium-only failures, unrelated).
- [x] `npm run release:check` is green — all 13 checks pass, including "standalone JS syntax" (critical here since this release hand-edits the minified script inside `standalone.html`).
- [x] All items from `docs/assurance/agentgate-2.14.2/release-checklist.md` automated gate still apply unchanged (no src/ runtime code changed).

## UX fixes verified this release

- [x] "Create Policy" and "Test Policy" use an on-page modal form (pre-filled example policy/test cases, inline error, Cancel/Confirm buttons) instead of native `prompt()` dialogs.
- [x] Behavior, Blast Radius, and Replay section headers show a "● LIVE" badge plus a short line distinguishing them from Attack Lab and from each other.
- [x] Monitor section header and the post-approval toast state that `agentgate dev` demo tool handlers are harmless no-ops.
- [x] Cost Control shows one explanatory message instead of a `$0` stat grid when no model pricing is configured.

## Operational / assurance gate

Unchanged from `docs/assurance/agentgate-2.14.2/release-checklist.md` — no new operational or assurance-gate work was in scope for this release.

## Conclusion

2.14.3 closes all 5 recommendations from a colleague's real hands-on trial of the live dashboard (1 real blocker — the `prompt()` dialogs — plus 4 clarity/labeling gaps). No security or runtime behavior changed. The known limitations recorded for 2.14.1/2.14.2 still apply and are unaffected.
