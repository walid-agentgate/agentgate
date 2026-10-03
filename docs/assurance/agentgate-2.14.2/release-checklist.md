# Release Checklist — AgentGate 2.14.2 (checked copy)

This release is scoped to release-engineering fixes only (version-text consistency, `release-check` regex, test path portability). Every item below carries over unchanged from `docs/assurance/agentgate-2.14.1/release-checklist.md` except where noted.

## Automated gate

- [x] `npm test` is green (192/194; same 2 known Chromium-only failures, unrelated).
- [x] `npm run release:check` is green — **fixed this release**: previously failed on "package version" because the check hardcoded a `2.13.x` regex; now accepts any valid semver and passes all 13 checks.
- [x] All items from `docs/assurance/agentgate-2.14.1/release-checklist.md` automated gate still apply unchanged (no src/ runtime code changed).

## Release-engineering fixes verified this release

- [x] `README.md` title and intro corrected from "v2.13.8" to "2.14.1"/"2.14.2"-consistent text.
- [x] `standalone.html` dashboard sidebar corrected from "AgentGate v2.13.8" to "AgentGate v2.14.1".
- [x] `test/v19.test.js`, `test/egress-guard.test.js`, `test/production-hardening.test.js` no longer hardcode `/tmp/...` — all three now use `fs.mkdtempSync(path.join(os.tmpdir(), ...))`.

## Operational / assurance gate

Unchanged from `docs/assurance/agentgate-2.14.1/release-checklist.md` — no new operational or assurance-gate work was in scope for this release. See that file for the full breakdown (local PostgreSQL ✅, managed provider ⬜ deferred, external review ⬜ deferred).

## Conclusion

2.14.2 closes the three concrete, fixable issues an independent trial review found (version-text inconsistency, a release-check regex that would fail on every future release, and non-portable test paths). No security or runtime behavior changed. The known limitations recorded for 2.14.1 still apply and are unaffected.
