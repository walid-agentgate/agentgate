# Production Deployment Reference

## Recommended topology

```text
Agent / Worker
      |
      v
AgentGate Runtime / MCP Gateway
      |
      +---- PostgreSQL (durable runs, approvals, policy metadata)
      |
      +---- Control Plane (private network)
      |
      +---- HTTPS / OIDC / reverse proxy
```

### Development vs production

- Development may use the built-in file persistence and local browser session.
- Production should use a durable PostgreSQL/Supabase-backed store, tenant-scoped authentication, HTTPS, and a private Control Plane network.
- Do not expose the service-role database credential or other server secrets to the browser.
- Keep the Control Plane separate from untrusted agent traffic where practical.

## PostgreSQL

Apply `schema/postgres.sql` to a dedicated database. The schema enables RLS and requires a tenant scope for reads/writes.

For pooled PostgreSQL clients, AgentGate scopes each transaction with `SET LOCAL agentgate.tenant_id`. The adapter also keeps explicit `tenant_id` predicates as defense in depth.

### Connection requirements

- TLS enabled between AgentGate and PostgreSQL.
- Least-privilege database role.
- Connection pool sized for the actual workload.
- Statement and connection timeouts configured by the deployment platform.
- Backups enabled at the database layer.

### Readiness

Use:

```text
GET /api/health
GET /api/ready
```

`/api/ready` should be used by orchestrators for readiness, while liveness should remain lightweight.

## Container deployment

The repository includes a Node 20 Alpine `Dockerfile`. Build and run it behind an HTTPS reverse proxy. Set `NODE_ENV=production` and a durable persistence configuration; do not use local JSON persistence as the authoritative store for a multi-instance production deployment.

## Rollout

1. Install the exact package version and retain the lockfile.
2. Run `npm test` and `node scripts/release-check.mjs`.
3. Apply database migrations/schema and verify RLS.
4. Start one canary instance in Observe/Shadow mode.
5. Run Attack Lab and application-specific abuse cases.
6. Verify audit export, replay, approval, and backup/restore procedures.
7. Switch only the reviewed tools to Enforce.
8. Expand tool-by-tool after acceptance criteria are met.

## Rollback

- Keep the previous application image/package available.
- Never roll back the database blindly: check schema compatibility first.
- Disable newly activated policies before reverting runtime code when policy/runtime compatibility is uncertain.
- Preserve exported audit evidence before destructive rollback operations.
