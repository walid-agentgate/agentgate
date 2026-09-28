# AgentGate — Managed PostgreSQL Production Acceptance Test

## Purpose

Run this against a **managed PostgreSQL test/staging database** (for example a managed PostgreSQL provider), not a local developer database. Do not use production customer data for destructive restore testing.

## Preconditions

- PostgreSQL endpoint and database credentials.
- Application role with only the permissions required by AgentGate.
- Separate migration/admin role.
- TLS enabled for database connections.
- `schema/postgres.sql` applied.
- RLS enabled and forced on `agentgate_records`.
- At least two tenants: `tenant-a` and `tenant-b`.

## Test 1 — Schema and RLS

Verify:

```sql
SELECT relrowsecurity, relforcerowsecurity
FROM pg_class
WHERE oid = 'agentgate_records'::regclass;
```

Expected: both values are `true`.

Verify the policy:

```sql
SELECT policyname, permissive, roles, cmd
FROM pg_policies
WHERE tablename = 'agentgate_records';
```

Expected: tenant isolation policy exists.

## Test 2 — Tenant A isolation

In an application connection:

```sql
BEGIN;
SELECT set_config('agentgate.tenant_id', 'tenant-a', true);
```

Create/read Tenant A records through `PostgresStoreAdapter`.

Then attempt to read Tenant B by ID/list query.

Expected: zero Tenant B rows.

## Test 3 — Cross-tenant write

With `agentgate.tenant_id = tenant-a`, attempt to insert a row with `tenant_id = tenant-b`.

Expected: PostgreSQL rejects it with an RLS policy violation.

## Test 4 — Backup

Create known test records:

- Tenant A Run: BLOCK, execution 0.
- Tenant A Approval: pending.
- Tenant B Run: ASK.
- Tenant B Approval: approved.

Run a provider-native backup or `pg_dump` where permitted.

Record backup identifier, timestamp, size, and checksum if available.

## Test 5 — Restore drill

Restore into an isolated staging database/clone.

Verify:

- Tenant A Run exists.
- Tenant A Approval exists.
- Tenant B Run exists.
- Tenant B Approval exists.
- Replay fields survive.
- `winningRule` survives.
- `ruleTrace` survives.
- execution count/state survives.
- RLS remains enabled and forced.
- cross-tenant read remains blocked.

## Test 6 — Application role boundaries

Verify the application role cannot:

- `DROP DATABASE`
- create/drop arbitrary databases
- become superuser
- disable RLS
- alter security policies
- perform unrestricted cross-tenant reads

Migration/admin credentials must be separate.

## Test 7 — TLS

Verify the application connection uses TLS and certificate verification appropriate to the provider.

Record the provider, TLS mode, and certificate verification configuration.

## Test 8 — Backup recovery objective

Record:

- backup frequency
- retention
- last successful backup timestamp
- restore start/end time
- RPO achieved
- RTO achieved
- whether restore verification is automated

## Acceptance criteria

| Gate | Required result |
|---|---|
| RLS enabled | PASS |
| RLS forced | PASS |
| Cross-tenant read | 0 rows / denied |
| Cross-tenant write | denied |
| Backup | successful |
| Restore | successful |
| Runs restored | PASS |
| Approvals restored | PASS |
| Replay restored | PASS |
| Tenant isolation after restore | PASS |
| App role least privilege | PASS |
| TLS | PASS |

A single failure in tenant isolation or unauthorized application privilege is a security blocker and should be remediated before production use.
