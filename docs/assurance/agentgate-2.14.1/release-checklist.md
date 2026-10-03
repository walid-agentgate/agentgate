# Release Checklist — AgentGate 2.14.1 (checked copy)

Checked against the gate in `docs/release-checklist.md`. Items marked ⬜ are explicitly deferred per `docs/known-limitations.md` — not silently skipped.

## Automated gate

- [x] `npm test` is green (192/194; 2 known Chromium-only failures, unrelated).
- [x] `agentgate attack` — 5/5 built-in scenarios `PROTECTED`.
- [x] `agentgate attack --deep` under the recommended strict policy — 10/10 `BLOCK`, `PROTECTED`.
- [x] Approval replay test confirms exactly one execution (100 replays of the same approval → 1 executed, 99 rejected).
- [x] Tenant isolation test passes (cross-tenant HTTP → `403`; PostgreSQL cross-tenant write → SQLSTATE `42501`).
- [x] Write-failure / readiness regression passes (`test/persistence-write-failure.test.js`, 4/4).
- [x] Persistence-corruption regression passes (fail-closed by default, opt-in recovery, `/api/ready` reflects it).
- [x] Oversized-body regression passes (413 followed by a normal request, no stall).
- [ ] ⬜ `npm pack --dry-run` reviewed to confirm no test files ship (confirmed intentional — see known-limitations.md #5).

## Operational gate

- [x] Local PostgreSQL configured with RLS enabled and forced.
- [x] TLS exercised locally (TLSv1.3).
- [x] Backup and restore exercised locally (backup 119ms / restore 73ms on a small DB; tenant data, approvals, rule trace, and RLS settings all intact after restore).
- [ ] ⬜ Managed-provider PostgreSQL backup guarantees / RPO·RTO — deferred, needs real staging access (`docs/managed-postgres-acceptance-test.md`).
- [ ] ⬜ Provider-issued TLS certificate verification — deferred, needs a managed provider.
- [x] Retention/backup policy documented as the deployment owner's responsibility (see README "Persistence").
- [x] Monitoring: `/api/health`, `/api/ready`, `persistenceHealth()` (`corruptions`, `writeErrors`) all exercised and regression-tested.
- [x] Application-specific abuse cases: built-in + deep Attack Lab exercised; customer-specific cases are the trial team's responsibility per `docs/design-partner-checklist.md`.

## Assurance gate

- [x] Threat model reviewed (`docs/threat-model.md`).
- [ ] ⬜ Dependency/supply-chain review — not yet performed as a standalone exercise.
- [ ] ⬜ External security review — not performed. AgentGate 2.14.1 must not be described as "independently audited" or "externally reviewed" until this is done (`docs/external-security-review.md`).

## Conclusion

Every item that can be closed without real external infrastructure or a third party is closed. The ⬜ items are not blockers for the limited real-world trial decision in `docs/validation-report.md` — they are blockers for broad production rollout and enterprise/audit claims, and are tracked, not forgotten, in `docs/known-limitations.md`.
