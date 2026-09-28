# AgentGate v2.13.8 — Security Hardening Release Report

## Changes closed from the v2.13.7 verification report

### 1. Generic secret detection

Added default field-aware egress protection for:

- `secret`
- `password`
- `passphrase`
- `private_key`
- `access_token`
- `refresh_token`
- `authorization`
- `auth_token`
- `client_secret`
- `api_secret`

Sensitive values are redacted as `[REDACTED:SECRET]` and the egress decision is `BLOCK` by default.

Regression coverage includes nested objects, arrays, inspection, and existing MCP egress behavior.

### 2. Enforcement configuration

The shipped `agentgate.config.mjs` now uses `mode: 'enforce'` so the packaged runtime example does not accidentally present Observe as an enforcement configuration.

Observe remains supported for explicit shadow/testing workflows.

### 3. PostgreSQL reference hardening

The reference schema now uses both:

```sql
ALTER TABLE agentgate_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE agentgate_records FORCE ROW LEVEL SECURITY;
```

The managed production acceptance procedure remains separate because it requires a real managed PostgreSQL environment.

### 4. External security review

No external audit is claimed. The release contains a reviewer-ready test pack covering authentication, authorization, tenant isolation, runtime enforcement, approval races, egress, malformed input, MCP boundaries, replay/audit integrity, persistence, and abuse controls.

### 5. Managed PostgreSQL production acceptance

The release contains a provider-neutral acceptance test covering RLS, tenant isolation, backup/restore, application-role privileges, TLS, RPO/RTO, and restore verification.

## Release verification executed in this environment

- `npm test` — 144/144 PASS.
- `node bin/agentgate.js --version` — 2.13.8.
- `node bin/agentgate.js doctor` — OK, enforce mode, no warnings.
- `node bin/agentgate.js validate-security` — OK.
- `node bin/agentgate.js attack-ci` — 5/5 PROTECTED.
- `node --test test/release-browser-smoke.mjs` — PASS.
- `npm run benchmark` — PASS, environment-specific baseline.
- `npm run release:check` — PASS.
- `npm audit --omit=dev` — 0 vulnerabilities reported.

## Remaining evidence gates

These cannot honestly be marked complete by an internal local build:

1. Independent external security review — requires an independent reviewer and dated report.
2. Managed PostgreSQL production acceptance — requires the target managed PostgreSQL environment and its backup/restore evidence.
3. Production SLA/capacity — requires HTTP + managed DB + network testing in the target deployment environment.

The release therefore closes the code-level finding and packages the remaining independent/production evidence tests without falsely claiming those external validations.
