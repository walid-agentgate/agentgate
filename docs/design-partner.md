# AgentGate Design Partner Program

AgentGate is introduced to a design partner around one measurable runtime boundary, not as a general-purpose AI security replacement.

## First use case: Support Refund Safety

Start with one side-effecting tool such as `refund`.

```text
Agent request
    ↓
AgentGate
    ↓
ALLOW / ASK / BLOCK
    ↓
Tool execution
    ↓
Audit + Replay evidence
```

The default Support Refund Safety Pack uses:

- refunds → `ASK`
- `> $5,000` → `BLOCK`
- the pack's `autoApproveAmount` remains available for policy evolution, but this conservative pack does not bypass the runtime's destructive-action approval boundary
- invalid amount types → fail closed through the runtime policy engine
- `export_all` → `BLOCK`

The pack is a starting point, not a compliance guarantee. Review thresholds and tool semantics before enforcement.

## 10-minute first protection

```bash
npm install agentgate-runtime-control
npx agentgate pack list
npx agentgate pack init support-refund-safety
npx agentgate simulate
npx agentgate attack
```

For a focused demonstration:

```bash
npx agentgate demo refund
```

The generated configuration starts in `enforce` mode for the packaged safety default. If a team wants Shadow/Observe, it must explicitly set `mode: 'observe'` and treat that configuration as non-enforcing.

## Rollout

1. Use sandbox or replay traffic.
2. Start in `observe` mode.
3. Compare AgentGate's proposed decisions with actual tool behavior.
4. Run normal and adversarial cases.
5. Move one tool to `enforce` only after review.
6. Preserve replayable evidence for every sensitive decision.

## Acceptance criteria

- `BLOCK → handler execution = 0`
- `ASK → pre-approval execution = 0`
- approved action executes exactly once
- cross-tenant access = 0
- egress secret leakage = 0
- audit mismatch = 0

AgentGate does not claim to prevent every prompt-injection technique and does not replace application authorization, IAM, network isolation, or provider controls.
