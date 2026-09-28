# Incident Response Runbook

This runbook is an operational template for AgentGate deployments. It does not replace the customer's incident-response policy.

## Severity

### SEV-1
Confirmed or suspected unauthorized side effect, cross-tenant data exposure, credential compromise, or bypass of an enforced security boundary.

### SEV-2
Security control degradation without confirmed unauthorized side effect, persistent service failure, or material audit/replay loss.

### SEV-3
Non-security defect, degraded dashboard, reporting issue, or recoverable integration problem.

## Immediate containment

1. Preserve relevant run IDs, approval IDs, policy versions, timestamps, and request metadata.
2. Activate the kill switch or move affected tools to Block/Observe as appropriate.
3. Revoke or rotate compromised credentials.
4. Isolate the affected tenant/tool/integration.
5. Preserve database and application logs before cleanup.

## Investigation

Correlate:

```text
runId
approvalId
tenantId
agent
policy version
winningRule
ruleTrace
tool/action
time window
egress findings
```

Use Replay and Audit Export before modifying historical records.

## Recovery

1. Patch or roll back the affected runtime/policy.
2. Re-run the relevant Attack Lab and customer-specific abuse cases.
3. Verify tenant isolation.
4. Verify approval single-execution behavior.
5. Restore from backup if data integrity is affected.
6. Document the exact recovery point and customer impact.

## Post-incident

Record root cause, affected versions, scope, evidence, containment, customer notification decision, corrective action, and regression tests. Add a regression test for every confirmed bypass or operational failure.
