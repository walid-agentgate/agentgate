# Observability and Alerting Runbook

## Health

Probe:

```text
GET /api/health
GET /api/ready
```

## Security alerts

Alert on:

- unexpected increase in BLOCK/ASK volume for a production tool;
- cross-tenant authorization failures;
- repeated egress secret findings;
- approval failures or abnormal approval volume;
- kill-switch activation;
- policy activation/rollback events;
- audit persistence failures.

## Performance alerts

Alert on sustained P95/P99 latency above the deployment's tested baseline, error rate, and database connection failures. Do not use the development benchmark as an SLA.

## Operational dashboards

At minimum track:

```text
requests
ALLOW / ASK / BLOCK
handler executions
approval resolution latency
policy version
run persistence failures
API errors
P50 / P95 / P99
active tenants
```

Use `/api/metrics`, `/api/observability`, `/api/security-report`, and `/api/audit/export` as evidence sources where appropriate.
