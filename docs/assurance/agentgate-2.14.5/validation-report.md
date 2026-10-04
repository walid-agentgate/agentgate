# AgentGate 2.14.1 — Validation Report

- **Product:** AgentGate (`agentgate-runtime-control`)
- **Version:** 2.14.1
- **Test dates:** 2.13.13 → 2.14.1 rounds, concluding 2026-10-02/03
- **Environment:** isolated sandbox + local PostgreSQL 16
- **Scope:** runtime policy engine, control-plane HTTP API, local JSON and PostgreSQL persistence, action-name hardening, tenant isolation, backup/restore, TLS (local), load/stress, Attack Lab
- **Out of scope (see `docs/known-limitations.md`):** managed PostgreSQL provider acceptance, external/independent security review, multi-instance local JSON (by design, not supported)

## Summary

AgentGate implements a runtime control plane for AI agent tool execution — every tool call receives a deterministic `ALLOW` / `ASK` / `BLOCK` decision before the real handler runs, with human approval, single-use/replay-protected approvals, tenant isolation, audit evidence (run ID, rule trace, winning rule), and both local-JSON and PostgreSQL/RLS persistence.

Across four hardening rounds (2.13.14 → 2.14.1), independent stress testing found and verified the fix for:

| # | Finding | Severity | Status |
|---|---|---|---|
| 1 | Unrecognized action names (`grant_admin`, `transfer_money`, etc.) default-allowed | High | Mitigated — `unknownActionPolicy: 'block'`, `strictActionNames`, unconditional unsafe-name block, tool metadata as source of truth (2.14.0) |
| 2 | Oversized request body stalled the *next* request on the same connection | P0 | Fixed and regression-tested (2.13.15) |
| 3 | Corrupted persistence file silently reset to empty (silent data/audit loss) | P0 | Fixed — fails closed by default, opt-in quarantine+recovery (2.13.15) |
| 4 | Disk-full/write-failure not reflected in readiness, and risked crashing the whole control-plane process on one failed write | Medium/High | Fixed — `/api/ready` reflects `degraded`, auto-recovers, request handler isolated from process-wide crash (2.14.1) |

## What was tested (highlights)

- Load/stress: 5,000 `tools/call` (~15,587 req/s, 0 errors); 2,000 approvals (2,000 executed, 0 errors) — sandbox, not a production SLA claim.
- Authentication/replay: expired/revoked/fake keys → `401`; conflicting duplicate headers → `401`; same approval replayed 100× → exactly 1 executed, 99 rejected.
- Malformed/adversarial input: NUL, control characters, bidi overrides, fullwidth forms, path-traversal-looking names — all blocked under the recommended strict policy (10/10 in the deep Attack Lab run).
- Persistence corruption, `kill -9` mid-write, real disk-full inside a 256 KiB tmpfs, permission failure.
- PostgreSQL: RLS enabled+forced, tenant isolation (cross-tenant write → `42501`), optimistic concurrency (second writer → `Concurrent update detected`), backup/restore (backup 119ms / restore 73ms on a small DB, all tenant data and rule-trace evidence intact after restore), TLS 1.3 locally.
- Multi-instance local JSON: confirmed the documented single-process boundary (200 runs recorded instead of 400 across two processes) — expected, not a defect.
- Built-in Attack Lab: 5/5 built-in scenarios `PROTECTED`; deep (unrecognized-action-name) scenarios 10/10 `BLOCK` under the recommended strict production policy.
- Full regression suite: 194 automated tests, 192 passing; the 2 failures are a Chromium-dependent browser smoke test unrelated to any of the above (expected in headless/no-Chromium environments).

Full narrative detail, reproduction steps, and the original walkthrough live in the stress-test reports exchanged during development; this document is the durable summary kept with the release.

## Decision

> **GO for a limited real-world trial** — one or a few sensitive tools, staging or a tightly scoped production slice, PostgreSQL/Supabase if more than one process/instance is involved, the recommended strict policy defaults enabled, backups taken before running anything destructive.
>
> **NO-GO for broad production rollout or any "enterprise-grade" / "independently audited" claim** until the items in `docs/known-limitations.md` are closed (managed-provider acceptance test, external security review).

Recommended production policy baseline for the trial:

```js
createMCPGateway({
  mode: 'enforce',
  policies: { unknownActionPolicy: 'block', strictActionNames: true, productionBlock: true }
});
```

plus `registerTool({ name, actionClass: 'destructive', requiresApproval: true, environments: [...] })` for every sensitive tool, rather than relying on the caller-supplied action-name string alone.

See `docs/release-checklist.md` for the gate this version was checked against, and `docs/assurance/agentgate-2.14.1/` for the machine-readable evidence (test results, checksums, release decision) kept alongside this report.

## Addendum — independent trial review (2026-10-03)

A second-opinion review of the repository (not the AI-assisted testing above) checked out the project on a plain Linux environment and found three real, fixable issues, now closed:

| Finding | Fix |
|---|---|
| `README.md` title/intro and `standalone.html` sidebar still said "v2.13.8" while `package.json` was `2.14.1` — confusing for anyone trying to identify the running version | Updated both to `2.14.1`; `bin/agentgate.js --version` already read `package.json` dynamically and was never wrong |
| `npm run release:check` failed because `scripts/release-check.mjs` hardcoded `/^2\.13\.\d+$/` for the version check | Changed to a general semver check (`/^\d+\.\d+\.\d+$/`) so it doesn't need editing on every release |
| Three test files (`test/v19.test.js`, `test/egress-guard.test.js`, `test/production-hardening.test.js`) used hardcoded `/tmp/...` paths, which fail with `ENOENT`/`EACCES` on any system where a world-writable `/tmp` doesn't already exist (seen on a plain Linux checkout; the same class of issue would hit Termux or Windows) | Switched all three to `fs.mkdtempSync(path.join(os.tmpdir(), ...))`, matching the pattern already used in `test/persistence-write-failure.test.js` and `test/persistence-corruption.test.js` |

Full regression suite after the fix: 194 tests, 192 passing (the same 2 pre-existing Chromium-dependent browser smoke tests, unrelated). `npm run release:check` now passes all 13 checks.

The same review's conceptual points — Attack Lab is a verification tool rather than a safety guarantee, protection depends on tools being registered correctly, load numbers aren't a production SLA, backup/incident-response remain the operator's job — were already true and are now recorded explicitly in `docs/known-limitations.md` (items 6–9) rather than left implicit.

## Addendum — colleague hands-on dashboard trial (2026-10-04)

A colleague ran `agentgate dev` and used the live dashboard (`standalone.html`) with no prior explanation, as a fresh-eyes usability trial (distinct from the automated/AI-assisted testing above). They found one real blocker and four clarity gaps, all fixed in 2.14.3:

| Finding | Fix |
|---|---|
| "Create Policy" / "Test Policy" used the browser's native `prompt()` dialog, which could silently stall the page for someone not expecting it | Replaced with an on-page modal form, pre-filled with a working example policy/test case |
| Not obvious which sections show live gateway data vs. which run simulated scenarios | Added a "● LIVE" badge and a one-line differentiation note to Behavior, Blast Radius, and Replay |
| Approving a request in the demo looked like it performed a real refund/delete/export | Monitor header and the post-approval toast now say explicitly that demo tool handlers are no-ops |
| Cost Control showed a grid of `$0` tiles with no indication that pricing simply wasn't configured | Replaced with one explanatory message when no pricing is set, instead of misleading `$0` figures |

This was a UI/labeling pass only — no runtime, policy, or security behavior changed. Full regression suite: 194 tests, 192 passing (same 2 known Chromium-only failures). `npm run release:check` passes all 13 checks.

## Addendum — second colleague trial, a real bug found (2026-10-04)

The same colleague ran the trial again against the 2.14.3 dashboard and found a genuine functional bug, not just a labeling gap:

| Finding | Severity | Fix |
|---|---|---|
| Creating a policy draft showed a "Draft ... created" success toast, but the policy list stayed on "No policies yet," and `GET /api/policies` returned an empty array even right after creation | **High — real data-visibility bug** | `PolicyRegistry.list()`/`#versions()` in `src/policy-registry.js` required an exact `name` to match anything; the dashboard's "list all" call never sends one. Fixed by treating a missing name as "match all" (matching the already-correct behavior of `PolicyBundleRegistry.list()`). Added a regression test. |
| Policy-name input's placeholder text could read as a pre-filled value rather than an example | Low | Reworded to make clear the field is empty |
| Behavior/Blast Radius sections still needed inline (not just header) context on what findings/scores mean | Low | Added inline clarifying text |

The draft-creation bug was present in 2.14.1–2.14.3 — every "Create Policy" through the dashboard silently failed to appear in the list, even though the data was saved correctly to disk and reachable via `list(name)` for that exact name. This is now fixed and covered by a regression test in `test/policy-registry.test.js`. No other runtime/security behavior changed. Full regression suite: 195 tests, 193 passing (same 2 known Chromium-only failures). `npm run release:check` passes all 13 checks.

## Addendum — third colleague trial, a second real bug found (2026-10-04)

The same colleague re-tested after the 2.14.4 fix, confirmed the policy-list bug was resolved (new policies appear immediately, old ones don't disappear, Test/Activate work, state survives a page reload), then found one more real bug while testing:

| Finding | Severity | Fix |
|---|---|---|
| The "New policy" modal's example policy (`{refund:{max:5000}}`) uses a shape the engine never reads — `refund.max` is simply ignored. The engine only reads flat fields (`approvalAmount`, `autoApproveAmount`, `requireApprovalForDestructive`, ...), documented and used everywhere else in the project. So the example silently did nothing, and the pre-filled test case (amount 100 → expected `ALLOW`) always failed, since any `refund` falls back to the default "destructive action requires approval" (`ASK`) rule | Medium — wrong-by-construction example, not a runtime defect | Replaced the example with the real, documented policy shape. Verified directly against `evaluate()`: amount 100 → `ALLOW`, amount 1000 → `ASK`, amount 6000 → `BLOCK`, matching the pre-filled test cases exactly. Added a regression test that extracts both the example policy and the example test cases from `standalone.html` and checks them against the real engine together, so they can't silently drift apart again. |
| Dashboard sidebar's version tag was hardcoded static text and had already gone stale twice across this trial | Low | Sidebar now fetches the real version from `/api/health` (already public, no auth change needed) at page load |

No runtime/security/policy-evaluation logic changed — only the dashboard's own example content and version display. Full regression suite: 196 tests, 194 passing (same 2 known Chromium-only failures). `npm run release:check` passes all 13 checks.
