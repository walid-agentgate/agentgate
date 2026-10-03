Release: AgentGate 2.14.1
Decision: READY FOR LIMITED REAL-WORLD TRIAL
Approved by: project team (Walid)
Date: 2026-10-03

P0 open issues: 0
P1 open issues: 0 (packaging/documentation items closed as part of this release package)
Known limitations: see known-limitations.md (local-JSON single-process boundary, no proactive disk-full probe, managed PostgreSQL provider untested, no external security review, npm package ships without tests — all by design or explicitly deferred, none block the limited trial)

Scope of this trial:
- One or a few sensitive tools (refund, delete, production deploy, data export, billing/CRM edits).
- Staging, sandbox, or a tightly scoped production slice — not broad production rollout.
- PostgreSQL/Supabase persistence if more than one process/instance is involved; local JSON only for single-process use.
- Recommended strict policy baseline enabled: unknownActionPolicy: 'block', strictActionNames: true, productionBlock: true, every sensitive tool registered with real actionClass/requiresApproval/environments metadata.
- Backups taken before running anything destructive.
- No production customer data in the first trial.

This decision does not claim an external security audit, managed-provider acceptance, or multi-instance local-JSON support. Development is frozen at this scope until real trial feedback (see docs/known-limitations.md and the "when to resume development" signals in the validation report) calls for a specific, named change — not for open-ended feature work.
