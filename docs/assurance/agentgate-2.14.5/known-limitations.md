# Known Limitations — AgentGate 2.14.1

This file is the single source of truth for what AgentGate 2.14.1 does **not** yet guarantee. It exists so that an open item is recorded once, clearly, instead of being treated as a reason to keep developing indefinitely. See `docs/validation-report.md` for the full test history behind each line.

## 1. Local JSON persistence is single-process only

Running more than one `createMCPGateway({ persistence: sameDir })` process against the same directory causes last-writer-wins / lost updates (confirmed: 2 processes × 200 calls each → 200 runs recorded instead of 400, plus transient `ENOENT` on `runs.json.tmp` rename races). This is a documented boundary, not a bug to fix in local JSON mode.

**Mitigation:** use the PostgreSQL/Supabase adapter (`src/postgres-adapter.js`) for any deployment with more than one process or instance. `agentgate doctor` should warn (see below) if local JSON is selected in a production-looking environment.

## 2. No proactive disk-full detection before the first failed write

`PersistentCollectionStore` detects and reports a write failure (ENOSPC/EACCES) only *after* a write is attempted — it does not probe free disk space ahead of time (`statfs`-style). If the disk fills up with no AgentGate write in between, `/api/ready` can still read `200` until the next write happens.

**Mitigation:** pair AgentGate's write-failure detection with normal infrastructure disk-space monitoring. A proactive `statfs` probe is a candidate P2 improvement, not a blocker for a limited trial.

## 3. Managed PostgreSQL provider not yet tested

RLS, tenant isolation, optimistic concurrency, backup/restore, and TLS have all been verified against a **local** PostgreSQL 16 instance. None of the following have been verified against a real managed provider (RDS, Supabase Cloud, Cloud SQL, etc.):

- provider backup guarantees / RPO/RTO
- failover and standby promotion
- provider-issued TLS certificate verification
- managed monitoring/alerting integration

**Status:** documented gap. Needs a real staging account before claiming managed-provider support. See `docs/managed-postgres-acceptance-test.md` for the test pack to run once that access exists.

## 4. No external security review has been completed

All security testing to date (stress tests, Attack Lab, adversarial action names, fuzzing-style malformed input) was performed by the project's own team using AI-assisted testing. No independent third party has reviewed or signed off on AgentGate's security properties.

**Status:** do not describe AgentGate as "independently audited" or "externally reviewed" until this actually happens. See `docs/external-security-review.md` / `docs/external-security-review-test-pack.md` for the scope an external reviewer would run.

## 5. Published npm package does not include the test suite

`package.json`'s `files` field intentionally excludes `test/` from what's published to npm (tests aren't meant to ship to consumers). Running `npm test` inside an *installed* copy of the package will report 0 tests — this is expected. Regression testing must be run from the source repository (`git clone` + `npm test`), not from a consumer install.

## 6. Attack Lab is a verification tool, not a safety guarantee

The built-in and deep Attack Lab exercise a specific, curated set of scenarios and action names. A clean run (`PROTECTED`, 0 allowed) proves those scenarios are handled — it does not prove every tool in your application is safe, that every dangerous tool-chaining path is covered, or that the system is hardened against attack patterns nobody has written a case for yet. Treat it as one layer of evidence, alongside your own threat model and abuse cases, not a substitute for either.

## 7. Protection depends on every sensitive tool actually being registered correctly

AgentGate's decisions are only as good as the metadata behind them. A tool called outside the gateway, or registered without accurate `actionClass`/`requiresApproval`/`environments`, will not get the protection you expect — the policy can't act on information it was never given. This is an integration discipline the deploying team owns; AgentGate cannot detect a tool that bypasses it entirely.

## 8. Load/stress numbers are not a production SLA

The throughput and latency figures in `docs/validation-report.md` (~15,587 req/s, 0 errors at 5,000 calls) were measured in an isolated sandbox with in-process tool handlers and local persistence. They demonstrate the policy engine and control plane don't fall over under load — they are not a benchmark of your production stack, your PostgreSQL instance, multi-tenant contention, or failover behavior. Run your own benchmark with your real tools, payload sizes, and persistence backend before quoting a number externally.

## 9. Backup, retention, and incident response remain the operator's responsibility

`/api/ready` and `persistenceHealth()` report AgentGate's own view of its storage layer — they are not a substitute for infrastructure-level backup, restore testing, retention policy, encryption at rest, database access control, or an incident-response runbook. AgentGate surfaces signal; the operator still owns the response.

---

Nothing above blocks a limited real-world trial under the conditions in `docs/validation-report.md` section "GO decision" (single/few sensitive tools, staging or tightly scoped production, PostgreSQL if more than one process, strict policy defaults enabled, backups in place). It blocks broad production rollout and any "enterprise-grade" or "independently audited" marketing claim until closed.
