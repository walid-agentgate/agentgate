# Production Release Checklist

## Automated gate

- [ ] `npm test` is green.
- [ ] `node scripts/release-check.mjs` is green.
- [ ] `npm pack --dry-run` contains no tests, internal tarballs, or stale versions.
- [ ] `node --check` passes for extracted standalone JavaScript.
- [ ] release browser smoke passes.
- [ ] `agentgate dev` Live Attack Lab returns 5/5 protected in its demo environment.
- [ ] clean consumer install from the generated npm tarball passes.
- [ ] approval race test confirms exactly one execution.
- [ ] tenant isolation test passes.
- [ ] egress test passes.

## Operational gate

- [ ] Production PostgreSQL/Supabase is configured with RLS.
- [ ] TLS is enabled.
- [ ] Backup and restore have been exercised.
- [ ] Retention period is documented by the deployment owner.
- [ ] RPO/RTO are documented by the deployment owner.
- [ ] Incident-response contacts/runbook are configured.
- [ ] Monitoring and alerting are configured.
- [ ] Application-specific abuse cases are recorded.

## Assurance gate

- [ ] Threat model reviewed.
- [ ] Dependency/supply-chain review completed.
- [ ] External security review completed, if required by the customer/plan.

An unchecked external-review item must never be described as completed or certified.
