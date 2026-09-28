# AgentGate — External Security Review Test Pack

## Status

This is a test package for an **independent reviewer**. It is not an internal audit and must not be described as an external security review until an independent reviewer returns a dated report.

## Evidence baseline

Reviewer should record:

- AgentGate version and SHA-256 of the release ZIP.
- Node.js version and OS.
- `npm test` result.
- `npm audit --omit=dev` result.
- `node bin/agentgate.js doctor`.
- `node bin/agentgate.js validate-security`.
- `node bin/agentgate.js attack-ci`.
- HTTP Control Plane authentication mode.
- PostgreSQL version and RLS configuration when persistence is in scope.

## Required security tests

### A. Authentication / Authorization

1. Access every protected Control Plane endpoint without credentials.
2. Use an invalid API key.
3. Use a valid key belonging to Tenant A against Tenant B resources.
4. Attempt approval with a key that cannot approve that tenant/run.
5. Attempt replay with a key from another tenant.
6. Verify failures are fail-closed (`401`/`403`) and do not leak data.

Expected: no unauthorized action or cross-tenant data exposure.

### B. Runtime enforcement

Run the built-in Attack Lab and verify:

- Prompt injection → BLOCK, execution 0.
- Privilege escalation → BLOCK, execution 0.
- Destructive tool → BLOCK, execution 0.
- High-value refund → BLOCK, execution 0.
- Unsafe tool chaining → BLOCK, execution 0.

### C. Approval security

1. Create an ASK request.
2. Verify execution is 0 before approval.
3. Approve once and verify exactly one execution.
4. Replay the same approval request concurrently 10 times.
5. Verify only one approval wins and only one execution occurs.
6. Try approval from another tenant.

Expected: one successful resolution, no duplicate execution, no cross-tenant approval.

### D. Egress / secret leakage

Send representative outputs containing:

- `secret`
- `password`
- `passphrase`
- `private_key`
- `access_token`
- `refresh_token`
- `authorization`
- `client_secret`
- JWT
- API keys
- cloud access keys
- PEM private keys
- email and phone PII

Expected: sensitive values are REDACTED or BLOCKED according to policy and never appear in the returned output/audit preview where policy says they must not.

### E. Input robustness

Try malformed JSON, missing fields, wrong types, arrays where objects are expected, extremely long strings, nulls, duplicated fields, unexpected action/tool names, and invalid approval IDs.

Expected: controlled error; no process crash; no bypass to tool execution.

### F. MCP / tool boundary

1. Call an unregistered tool.
2. Call a registered destructive tool with a policy bypass attempt.
3. Attempt tool chaining where the second action is privileged.
4. Attempt to alter tool identity/action through user-controlled arguments.

Expected: authorization is based on trusted runtime context/policy, not merely model-provided text.

### G. Replay / audit integrity

Verify a blocked run contains:

- runId
- decision
- tool/action
- request/arguments as permitted by logging policy
- winningRule
- ruleTrace
- execution outcome
- approval state when applicable

Attempt to read or modify another tenant's run.

Expected: complete evidence for authorized users and no unauthorized access/modification.

### H. Persistence / PostgreSQL

Use the managed PostgreSQL acceptance pack in `docs/managed-postgres-acceptance-test.md`.

### I. Availability / abuse controls

Test rate limits, oversized requests, repeated authentication failures, approval floods, and run-retention pressure in a production-like environment.

Expected: bounded resource usage, controlled errors, and no security boundary bypass.

## Reviewer report format

The independent reviewer should return:

1. Scope and exclusions.
2. Environment and versions.
3. Methodology.
4. Test cases executed.
5. Findings with severity (Critical/High/Medium/Low/Informational).
6. Reproduction steps for each finding.
7. Evidence.
8. Remediation status.
9. Retest results.
10. Date and reviewer identity/organization.

Only after this report exists should AgentGate state that an external security review was completed.
