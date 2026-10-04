# 2.14.6 — Independent Technical Review: 6 Fixes (Replay History, Payload Masking, Metric Labeling, Version Consistency, Guided Setup, Layout Overflow)

An independent technical review (install → test → dashboard → Attack Lab → approval flow → Replay → Observability) rated the project 8.5/10 for a limited trial and asked for 6 fixes before freezing further. All 6 are done:

1. **Replay now browses history, not just the latest run.** Added a searchable list (by run ID, tool, action, or decision) of recent runs, selectable in place, plus a per-run JSON export button — previously Replay only ever showed the single most recent run gateway-wide, with no way to find a specific past one.
2. **Monitor no longer shows raw approval payloads by default.** Pending-approval cards now show a short human-readable summary (action · tool · amount) first, with the full payload behind a "View details" disclosure — and sensitive-looking fields (customerId, email, token, card, etc.) are masked there too, while operationally necessary fields (action, amount) stay visible so an approver can still decide. Regression-tested in `test/dashboard-payload-masking.test.js`.
3. **Observability's "Success" metric relabeled.** It's now "Executed cleanly," with "Blocked" and "Approvals" labeled as protective outcomes, not failures, plus an explanatory line: "A BLOCK or an ASK is a policy outcome, not an execution failure."
4. **Version consistency is now enforced, not just fixed.** README.md updated to v2.14.6, and `release-check.mjs` gained a permanent check that the README's version string matches `package.json` — this is the third time a stale version string in prose confused a reviewer (2.14.2, 2.14.5, now this one), so going forward it's a release gate, not a one-off fix.
5. **Added a 3-button guided-setup block to Overview** ("Try the Demo," "Protect my first tool," "Set up PostgreSQL staging") with short, directly-verified-against-the-real-API code samples — not an earlier draft that invented two APIs that don't exist (`agentgate.registerTool()` on a `createAgentGate()` instance, and a non-existent `createPostgresAdapter()` subpath export). Both corrected samples are regression-tested against the real exports in `test/dashboard-guided-setup.test.js`.
6. **Fixed horizontal overflow** on some viewports (long unbroken strings — run IDs, hashes — pushing the layout wider than the screen). Added `overflow-wrap`/`min-width:0`/`max-width:100%` guards.

Plus three smaller items from the same review:
- Overview's demo stat tiles now say "Demo/sample metrics below — not your environment's real telemetry" instead of relying on a small badge alone.
- README documents the real subpath-export story (most things come from the package root; a few lower-level pieces like `createControlPlane`/`PolicyRegistry` are subpath exports) — this was previously undocumented and easy to guess wrong.
- The npm package no longer ships `docs/assurance/*` (the versioned historical evidence trail, 5 folders and counting) — it's meant to stay in git history, not bloat every consumer's install. `release-check.mjs` now guards this too.

No policy-evaluation/decision logic changed. Full regression suite: 200 tests, 198 passing (same 2 known Chromium-only browser-smoke failures, unrelated — 4 new regression tests added). `npm run release:check` passes all 14 checks (one new check added this release).

# 2.14.5 — Second Real Bug Fix: Dashboard's Example Policy Used a Shape the Engine Never Reads

- **Fixed a second real bug, found by the same colleague's third trial**: the dashboard's "New policy" modal pre-filled an example policy `{refund:{max:5000}}` — but the real policy engine (`src/policy-engine.js`) never reads a nested `refund.max` field; it only reads flat fields like `approvalAmount`, `autoApproveAmount`, and `requireApprovalForDestructive` (the same shape used everywhere else in this project: `README.md`, `docs/quickstart.md`, `examples/basic.mjs`, etc). So the example policy silently did nothing, and the pre-filled test case in the "Test policy" modal (amount 100 → expected `ALLOW`) always failed, because any `refund` action falls back to "destructive action requires approval" (`ASK`) by default. Fixed the example policy to the real, documented shape (`{autoApproveAmount:500, approvalAmount:5000, requireApprovalForDestructive:false}`), verified against the live engine: amount 100 → `ALLOW`, amount 1000 → `ASK`, amount 6000 → `BLOCK` — exactly what the pre-filled test cases already expected.
- Added a regression test (`test/dashboard-policy-example.test.js`) that extracts both examples straight from `standalone.html` and checks them against the real engine, so the two can never silently drift apart again.
- The dashboard sidebar's version tag was hardcoded as static text (`AgentGate v2.14.1`) and had already drifted twice. It now fetches the real version from the already-public `/api/health` endpoint at load time, so it can't go stale again.
- Full regression suite: 196 tests, 194 passing (same 2 known Chromium-only browser-smoke failures, unrelated — 1 new regression test added). `npm run release:check` passes all 13 checks.

# 2.14.4 — Real Bug Fix: Dashboard "Create Policy" Always Showed an Empty List

- **Fixed a real bug, found by a second colleague trial**: `GET /api/policies` (the call the dashboard's Policies page uses to list everything) always returned `{"policies": []}`, even immediately after successfully creating a policy draft — the dashboard would show a "Draft ... created" success toast, then the list below would still say "No policies yet." The draft WAS being saved correctly to disk; it just could never be read back by the "list all" call. Root cause: `PolicyRegistry#versions()`/`list()` in `src/policy-registry.js` required an exact policy `name` to match anything, but the dashboard's "list all policies" call never sends a name (it wants everything). Fixed by treating a missing name as "match all," matching how the sibling `PolicyBundleRegistry.list()` already worked. This was a real data-visibility bug, not a UI/labeling issue — anyone using the Policies page to create more than a quick one-off policy would have hit it every time.
- Added a regression test (`test/policy-registry.test.js`) asserting `list()` with no name returns every policy, so this can't silently regress.
- Clarified the policy-name input placeholder so it reads as an example, not a pre-filled value (`"e.g. refund-safety — type a name, this box is empty"`).
- Behavior section now notes inline that a finding's count comes from Attack Lab/demo activity, not a real incident (in addition to the explanatory line already in the section header from 2.14.3).
- Blast Radius header now explains what "scope" and "targets" mean in plain language, and that the 0–100 score is a risk estimate, not an executive decision by itself.
- Full regression suite: 195 tests, 193 passing (same 2 known Chromium-only browser-smoke failures, unrelated — one new test added for the policy-list fix). `npm run release:check` passes all 13 checks.

# 2.14.3 — Dashboard UX Fixes (from a real colleague trial)

- Replaced the raw browser `prompt()` dialogs for "Create Policy" and "Test Policy" with a proper on-page modal form (name field, pre-filled example policy `{refund:{max:5000}}`, pre-filled example test cases, inline error message, Cancel/Create or Cancel/Run buttons). The old `prompt()` flow could silently hang the page for a tester who didn't expect a native browser dialog — this was the one real blocker the trial found.
- Added a "● LIVE" badge and a short differentiation line to the Behavior, Blast Radius, and Replay section headers, explaining how each one differs from Attack Lab and from each other, and that Attack-Lab-generated findings in Behavior are simulated test results, not real incidents.
- Clarified in the Monitor section header, and in the toast shown after approving a request, that `agentgate dev`'s demo tool handlers are harmless no-ops — approving a refund/delete/export in the demo does not perform a real side effect.
- Cost Control now shows one clear explanatory message ("cost tracking is not active yet — add pricing to see real numbers") instead of a row of `$0` stat tiles when no model pricing is configured, so a `$0` reading can no longer be mistaken for "spend is actually zero."
- No runtime/security/policy behavior changed — this release only touches `standalone.html` (the dev dashboard's UI/labeling). Full regression suite: 194 tests, 192 passing (same 2 known Chromium-only browser-smoke failures, unrelated). `npm run release:check` passes all 13 checks.
- Fixes all 5 recommendations from a colleague's hands-on trial of the live dashboard.

# 2.14.2 — Release-Engineering Consistency Fix

- Fixed stale "v2.13.8" version text in `README.md` (title and Design Partner Edition intro) and the `standalone.html` dashboard sidebar — both now correctly read `2.14.1`-era content matching `package.json`. (`bin/agentgate.js --version` was never affected; it already reads the version from `package.json` dynamically.)
- Fixed `npm run release:check` hardcoding a `2.13.x`-only version regex, which made it fail on every release past 2.13 for a reason unrelated to release quality. It now accepts any valid semver.
- Fixed three test files (`test/v19.test.js`, `test/egress-guard.test.js`, `test/production-hardening.test.js`) that used hardcoded `/tmp/...` paths instead of `os.tmpdir()`/`fs.mkdtempSync` — these failed with `ENOENT`/`EACCES` on any system where a world-writable `/tmp` isn't already guaranteed to exist (seen on a plain Linux checkout during an independent trial review; the same class of issue affects Termux and Windows).
- No runtime/security behavior changed. Full regression suite: 194 tests, 192 passing (2 known Chromium-only browser-smoke failures, unrelated). `npm run release:check` now passes all checks.
- Added `docs/known-limitations.md` items 6–9 (Attack Lab is a verification tool not a guarantee, protection depends on correct tool registration, load numbers aren't a production SLA, backup/incident-response remain the operator's responsibility) making points an independent trial review raised explicit rather than implicit.

# 2.14.1 — Write-Failure Observability & Crash-Safety Hotfix

- `PersistentCollectionStore.save()` still throws on every write failure (disk full, permission denied, ...) exactly as before — never swallowed — but now also records it on `lastWriteError`, which clears itself automatically the instant a later write succeeds.
- `gateway.persistenceHealth()` gained `writeErrors` alongside the existing `corruptions`; `degraded` is now true if either is non-empty.
- `GET /api/ready` now reflects an active write failure as `503`/`degraded: true`, the same way it already did for a recovered corruption, and recovers to `200`/`degraded: false` automatically once writes succeed again — no restart required.
- Fixed a latent crash risk in the control plane: a write failure (or any other thrown error) inside an HTTP request handler was previously an unhandled promise rejection capable of taking down the entire process over a single failed write. It is now caught and answered as a clean `500` for that one request; every other in-flight and future request is unaffected.
- Added `test/persistence-write-failure.test.js` covering all of the above.
- Closes the two open questions and the latent risk flagged by the independent 2.14 verification report following up on the real disk-full test.

# 2.13.8 — Production Readiness Pack
# 2.13.8 — Security Hardening

- Added generic sensitive-field egress protection for `secret`, `password`, `passphrase`, `private_key`, `access_token`, `refresh_token`, `authorization`, `auth_token`, `client_secret`, and `api_secret`.
- Sensitive-field values are redacted as `[REDACTED:SECRET]` and the egress decision is `BLOCK` by default.
- Added regression coverage for nested objects, arrays, inspection, and MCP egress behavior.
- Shipped example configuration defaults to `enforce` for the packaged runtime configuration.
- Forced PostgreSQL Row Level Security in the reference schema.
- Added an independent External Security Review test pack and a Managed PostgreSQL Production Acceptance test pack.
- No external security audit is claimed; those tests require an independent reviewer/managed provider environment.


- Added production deployment reference for PostgreSQL/Supabase, TLS, readiness, rollout and rollback.
- Added data-protection guidance for retention, encryption, backup/restore, RPO/RTO and deletion.
- Added incident-response runbook with severity, containment, investigation, recovery and post-incident regression steps.
- Added reproducible performance benchmark with P50/P95/P99 and throughput reporting.
- Added integration matrix and production release checklist.
- Added external security review scope/evidence package; explicitly does not claim an external audit was completed.
- Added automated release consistency checks for standalone JavaScript, package contents and production-readiness artifacts.

# 2.13.6 — Release Test Harness Fix
- Fixed the dev Attack Lab browser smoke assertion to avoid regex escaping inside an injected template literal.
- Release test now uses literal substring matching for `5/5 protected`.
- No runtime security behavior changed.

# 2.13.6 — Live Attack Lab Wiring Fix
- Registered all built-in Attack Lab demo tools in `agentgate dev`: `export_all`, `update_production`, `delete`, `refund`, and `publish`, with explicitly simulated handlers.
- Added registered-tool discovery to the gateway and made missing Attack Lab tools report as `SKIPPED` with `unregisteredTools` instead of false security failures.
- Added a real `agentgate dev` Attack Lab integration smoke and browser integration harness.
- Attack Lab status is `PROTECTED` only when all scenarios execute; partial tool coverage is reported as `PARTIAL`.

# 2.13.4 — Release Hardening
- Fixed standalone Control Plane JavaScript syntax error in Audit Export.
- Added release browser smoke coverage for the standalone Control Plane.
- Completed live policy lifecycle UI: Create → Test → Review → Activate.
- Added release version/archive consistency checks and removed stale internal tarballs from distribution.

# Changelog

## 2.13.4 — P1 Control Plane UX

- Live Attack Lab wired to the Control Plane gateway.
- Policy creation wired to the Policy Registry API.
- First 10 Minutes onboarding flow added to the Control Plane.
- HTTP audit JSON export added.
- Control Plane surfaces explicit API failure messages instead of silently presenting demo results.
- Version identity unified at 2.13.4.


# 2.13.4 — First-Client Hardening

- Fixed Design Partner CLI test to resolve the packaged `bin/agentgate.js` instead of a hardcoded `/mnt/data` path.
- Added a complete approval lifecycle to `createAgentGate`: `approve()`, `deny()`, `approvals()`, `getApproval()`.
- `protect()` ASK results now include an `approvalId` and preserve the original pending execution until approval.
- Updated standalone Control Plane version to 2.13.4 and clearly labeled static dashboard/Attack Lab areas as Preview where they are not live operations.
- Added SDK approval lifecycle documentation and regression tests.

# Changelog

## 2.13.2 — Commercial Readiness Pack
- Added technical validation case-study boundary and customer-case-study policy.
- Added initial pricing experiment.
- Added launch website copy and positioning.
- Added design-partner outreach scripts.
- Added marketing launch plan and claims policy.
- Updated standalone product shell messaging and version.


## 2.13.0 — Design Partner Edition

- Added three curated Policy Packs: support/refund, production DevOps, and customer-data export.
- Added `agentgate pack list|show|init|test` for fast, reviewable policy-pack setup.
- Added `agentgate demo refund` for a focused first-protection demonstration.
- Added deterministic Shadow Mode analysis and a `agentgate shadow` report command.
- Added Design Partner rollout, checklist, and case-study templates.
- Increased local SDK run retention default to 25,000 to preserve replay evidence under large adversarial runs.
- SDK runtime Run records now persist `winningRule` and `ruleTrace` alongside the decision evidence.
- Kept the deterministic runtime enforcement model unchanged.

# 2.12.2 — Release Confidence & Adversarial Hardening

- Security validation now uses real instrumented tool handlers to prove BLOCK happens before side effects.
- Added real cross-tenant HTTP validation using scoped Tenant A/B API keys and tenant mismatch enforcement.
- Added run retention status and near-limit warning events.
- MCP/control-plane version reporting now derives from package version instead of a stale literal.
- MCP and control-plane examples now support `PORT` without editing source.
- Release confidence target: AG-RED-TEAM with 10,000+ mixed requests, persistence, replay, concurrency, egress, approvals, and tenant isolation.

# Changelog

## 2.12.0 — Security Validation & Hardening

- Added deterministic security validation runner for runtime, approval, egress, malformed-input and tenant-isolation invariants.
- Added `agentgate validate-security` CLI gate with non-zero exit on failed security invariants.
- Added pre-execution blocking and approval-boundary regression checks.
- Added malformed-input resilience checks for the policy engine.
- Added tenant isolation validation over persisted runtime runs.

## 2.11.0 — Developer Preflight & Policy Simulation

- Added configuration validation and deployment safety warnings.
- Added `agentgate doctor` preflight diagnostics.
- Added deterministic `agentgate simulate` policy matrix.
- Added programmatic configuration validation and policy simulation exports.

## 2.10.1 — Release Candidate: Trust & Distribution

- Fixed npm package identity collision by publishing the product package under `agentgate-runtime-control`; the CLI command remains `agentgate`.
- Added `agentgate --help` and `agentgate --version`.
- Added explicit `agentgate dev --port <port>` handling and friendly `EADDRINUSE` errors.
- Added secure local development browser session for `agentgate dev`; production API authentication remains fail-closed.
- Seeded local dashboard with real ALLOW / ASK / BLOCK demo runs.
- Added deterministic policy `ruleTrace` and `winningRule` fields.
- Made Replay consume a real run and explain the winning rule and whether the tool handler executed.
- Reconciled refund examples and Quickstart expected outcomes.
- Updated MCP default server version and examples for configurable ports.
- Added 2.10.1 regression tests for policy explanations and local dashboard authentication.
- Full test suite: 112/112 passing.


## 2.10.0 — Security-Aware Observability & Agent Intelligence

- Added unified security-aware traces joining LLM, tool, policy, approval, execution, egress, behavior and cost stages.
- Added deterministic Agent Efficiency Score with transparent component weights.
- Added behavior × cost × security correlation analytics.
- Added cost analytics by agent, model, tool, action, tenant and customer/user.
- Added security-cost accounting for blocked calls, approvals, attack tests and egress blocks.
- Added deterministic month-end cost forecasting from month-to-date run-rate.
- Added control-plane APIs for traces, efficiency, correlation, cost analytics and forecasts.
- Expanded the dashboard to surface efficiency, security correlation, unified traces, cost analytics and forecast.
- Preserved deterministic runtime authorization; analytics never becomes the authorization authority.
- Fixed persistence of enriched run/cost/egress state after runtime execution.

## 2.9.0 — Agent Observability & Cost Control

- Added unified runtime observability over AgentGate runs: success/error rates, decision counts, P50/P95/P99 latency, tool/agent/model breakdowns, and security-aware telemetry.
- Run records now capture model/usage metadata, execution latency, and calculated cost when pricing is configured.
- Added provider-neutral model pricing registry; pricing is explicit and configurable rather than hard-coded to potentially stale provider rates.
- Added daily/monthly cost budgets with deterministic ALLOW / ASK / BLOCK decisions.
- Budget evaluation can use persisted runtime history, avoiding dependence on process-local cost state.
- Added Control Plane APIs for observability, cost status, pricing and budget configuration.
- Added dashboard sections for Observability and Cost Control.
- Added regression coverage for cost calculation, budget enforcement, persisted history, gateway integration and Control Plane endpoints.
- Test suite at release preparation: 110/110 passing.

## 2.6.0 — Production Data & API Hardening

- Postgres adapter now supports tenant-scoped RLS sessions and optimistic concurrency updates.
- Supabase persistence requires explicit tenant scope for reads and writes.
- API key revoke/rotate operations are tenant-bound.
- Organization, billing, usage and tenant-management routes enforce tenant ownership boundaries.
- Rate limiting now applies at both network/API-key and authenticated-tenant layers.
- OIDC validation applies clock tolerance correctly and can enforce maximum token age.
- Production database schema includes tenant isolation policy and record versions.


## 2.5.0 — Tenant-Isolated Policy Governance

- Policy Registry versions, activation, diff, audit, and reads are tenant-scoped.
- Policy Bundles are tenant-scoped with isolated versions and activation state.
- Runtime policy resolution uses the authenticated tenant context.
- Tenant policy activation no longer mutates shared global policy state.
- Added cross-tenant policy and runtime enforcement regression tests.
- Test suite: 80/80 passing.

### Security Hardening (included in 2.5.0)

- Enforced authenticated tenant identity over request-body `tenantId`.
- Added tenant-scoped runs, approvals, replay, behavior and blast-radius reads.
- Added tenant binding to runtime runs and approvals.
- Prevented cross-tenant approval resolution.
- Added SSE tenant filtering.
- Added HTTP body-size limits to the Control Plane and MCP server.
- Hardened webhook delivery against localhost, private, link-local and metadata targets, with DNS resolution and redirect rejection.
- MCP HTTP server is local-only by default; non-local deployment requires an authentication hook.
- Added dedicated cross-tenant and SSRF security regression tests.

## 2.2.0

- Public-launch packaging and documentation
- Five-minute quickstart
- Refund-agent and policy-bundle examples
- Docker deployment baseline
- npm package file allowlist
- Security policy and contribution guide
- Launch/package smoke tests

## 2.1.0

- Runtime telemetry and latency metrics
- Runtime event stream
- Health and readiness endpoints
- Sliding-window rate limiting
- OIDC JWT validation
- Policy bundle control-plane integration

## 2.0.0

- Runtime event bus
- Policy bundles
- Admin RBAC
- OIDC claim mapping
- Enterprise runtime foundations

## 2.7.0 — Security Edge

- MCP Security Scanner with dangerous-tool, description-injection, sensitive-input and weak-schema findings.
- Stable tool contract fingerprints.
- Tool trust pinning and rug-pull/schema-drift detection.
- Runtime emergency kill switch with tenant-scoped Control Plane access.
- `agentgate scan` CLI with strict CI mode.
- `agentgate attack-ci` security gate.
- MCP scanner library export.

## 2.8.0 — Response / Data Egress Guard

- Added deterministic response/data egress inspection and transformation.
- Added ALLOW / REDACT / BLOCK egress decisions.
- Added detection for common API keys, private keys, bearer tokens, JWTs, email, phone, and card-like data.
- Integrated egress enforcement into MCP tool responses and approval execution.
- Added egress audit metadata and runtime events.
- Added configurable per-type egress rules.

## 2.13.1 — Design Partner Kit

- Added `agentgate partner init [pack]` to generate a controlled partner workspace.
- Added `agentgate partner check <report.json>` for deterministic acceptance-gate validation.
- Added Design Partner Kit, intake template, pilot workflow, scorecard, and exit-report templates.
- Preserved the 2.13.0 runtime and security boundaries.
