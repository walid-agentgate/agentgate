# Data Protection, Retention, Backup and Restore

## Scope

AgentGate can persist runs, approvals, policy metadata and audit evidence. The application owner is responsible for classifying the data and choosing the retention period appropriate to the workload.

## Retention

The in-process/local stores enforce bounded retention. Configure the production database retention separately; do not treat the local `maxRuns` limit as a compliance retention policy.

Recommended operational baseline for a pilot:

- Hot audit/run data: 30 days.
- Exported security evidence: retain according to the customer's compliance requirement.
- Approvals: retain with the associated audit record for the same period unless a stricter requirement applies.

These are deployment defaults, not legal advice; customers must set their own policy.

## Encryption

- TLS for AgentGate-to-database and user-to-Control-Plane traffic.
- Encrypt database storage using the cloud/database provider's encryption-at-rest controls.
- Encrypt backups using provider-managed or customer-managed keys according to the customer's requirements.
- Never put API keys, bearer tokens, database credentials, or private keys into policy definitions, browser bundles, or exported audit files unless explicitly required and protected.

## Backup

For PostgreSQL, enable automated provider backups and point-in-time recovery where available. For higher assurance, keep an independent backup/export according to the customer's RPO.

Minimum pilot procedure:

1. Take/verify a database backup.
2. Record backup timestamp and database schema version.
3. Restore into an isolated database.
4. Run tenant-isolation, replay, approval, and audit-read tests.
5. Record restore duration.

## Restore acceptance targets

The deployment owner should explicitly choose:

- RPO: maximum acceptable data loss.
- RTO: maximum acceptable recovery time.

AgentGate does not claim a universal RPO/RTO because those values depend on the customer's database and infrastructure.

## Deletion

Customer data deletion must be performed at the database layer according to the tenant/data-retention policy. Verify that backups and exported evidence follow the same contractual deletion requirements.
