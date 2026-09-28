# Production Quickstart: PostgreSQL

This is a reference deployment for a pilot. Put a TLS reverse proxy in front of AgentGate in any non-local deployment.

## 1. Set the database secret

```bash
export POSTGRES_PASSWORD='use-a-long-random-secret'
```

## 2. Start PostgreSQL and AgentGate

```bash
docker compose -f docker-compose.production.yml up -d --build
```

## 3. Verify readiness

```bash
curl -fsS http://127.0.0.1:8787/api/health
curl -fsS http://127.0.0.1:8787/api/ready
```

## 4. Verify the database schema

The compose file mounts `schema/postgres.sql` as an initialization script. For an existing database, apply the schema through your normal migration/change-management process instead of relying on container initialization.

The schema must have:

- `agentgate_records`
- `(tenant_id, kind)` index
- RLS enabled
- tenant-scoped `USING` and `WITH CHECK` policy

## 5. Production hardening

- Replace the sample password with a secret-manager value.
- Put the Control Plane behind HTTPS/OIDC or another production authentication boundary.
- Do not publish PostgreSQL directly to the Internet.
- Configure automated backups and test restore into an isolated database.
- Configure monitoring for `/api/health`, `/api/ready`, error rate, latency and database connectivity.
- Keep the exact image/package version and database schema version together for rollback decisions.

## 6. Backup/restore acceptance test

Record:

```text
backup timestamp:
backup identifier:
restore target:
restore duration:
RPO:
RTO:
replay verification:
approval verification:
tenant-isolation verification:
```
