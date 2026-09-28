# External Security Review Package

## Status

**Not completed.** This repository contains a preparation package only. No third-party security audit, penetration test, SOC 2 assessment, or certification is claimed by AgentGate.

## Scope for an external reviewer

1. Runtime policy enforcement and pre-execution boundary.
2. Approval lifecycle and concurrent approval race.
3. MCP Gateway and tool registration.
4. HTTP Control Plane authentication and authorization.
5. Tenant isolation and replay access control.
6. Egress inspection/redaction/blocking.
7. Persistence and Postgres/Supabase RLS assumptions.
8. Audit integrity and export.
9. Local/dev authentication boundaries.
10. Dependency and supply-chain exposure.

## Evidence to provide

- Release ZIP and SHA-256.
- `npm pack --dry-run` output.
- Automated test report.
- Threat model.
- Production deployment architecture.
- Database schema/RLS policy.
- Incident-response runbook.
- Backup/restore evidence.

## Acceptance

The review is considered complete only when an independent reviewer supplies a dated report with scope, methodology, findings, severity, and remediation status.
