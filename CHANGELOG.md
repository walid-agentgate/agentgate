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
