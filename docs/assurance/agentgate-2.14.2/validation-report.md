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
