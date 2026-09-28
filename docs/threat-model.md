# AgentGate Threat Model

## Assets

- Tool execution authority.
- Approval decisions.
- Run/replay evidence.
- Tenant-scoped audit data.
- Policy definitions and versions.
- Credentials used by the protected application.

## Trust boundaries

```text
Untrusted model/agent
        |
        v
AgentGate runtime boundary
        |
        +--> policy engine
        +--> approval boundary
        +--> egress guard
        +--> audit/persistence
        |
        v
Side-effecting tool / MCP / API
```

## Threats and controls

| Threat | Primary control | Evidence |
|---|---|---|
| Prompt injection causes dangerous tool call | Deterministic tool/action policy | Attack Lab |
| High-value action bypasses approval | ASK before handler execution | Approval tests |
| Double approval causes duplicate side effect | Single-resolution approval state | Approval race test |
| Destructive tool executes | BLOCK before handler | Security validation / Attack Lab |
| Cross-tenant replay/read | Tenant-scoped API and persistence | Tenant tests + RLS schema |
| Secret/PII leaves tool boundary | Egress inspection | Egress tests |
| Policy drift | Versioned policy registry/test/activate | Policy lifecycle tests |
| Audit loss during rollback | Export + durable store + backup procedure | Operations runbook |
| Credential theft outside AgentGate | Application/IAM/secret-manager controls | Out of scope |
| Compromised host/kernel | Infrastructure security | Out of scope |
| Unsafe model output without tool call | Model/provider safety controls | Out of scope |

## Security boundary

AgentGate is an execution-control layer. It is not an IAM replacement, secret manager, network firewall, model safety guarantee, or host security boundary.
