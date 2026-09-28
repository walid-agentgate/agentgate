# AgentGate Quickstart


## 0. Start with a policy pack

For the fastest first protection, use the Support Refund Safety Pack:

```bash
npx agentgate pack list
npx agentgate pack init support-refund-safety
npx agentgate simulate
npx agentgate attack
```

The generated config starts in `enforce` mode. For a focused Shadow/Observe demonstration, explicitly change `mode` to `observe` and do not use that configuration for sensitive production tools:

```bash
npx agentgate demo refund
```

See [`docs/design-partner.md`](design-partner.md) for the observe → enforce rollout and acceptance criteria.

AgentGate is a runtime control plane for AI agent tool execution. Put it between your agent and side-effecting tools so every action gets a deterministic `ALLOW`, `ASK`, or `BLOCK` decision.

## 1. Install

```bash
npm install agentgate-runtime-control
```

## 2. Protect a tool

```js
import { protect } from 'agentgate-runtime-control';

const refund = protect(
  async ({ amount, customerId }) => ({ refunded: amount, customerId }),
  {
    approvalActions: ['refund'],
    autoApproveAmount: 500,
    approvalAmount: 5000
  }
);

await refund({ amount: 250, customerId: 'cus_123' });
// status: executed

await refund({ amount: 1200, customerId: 'cus_123' });
// status: approval_required

// amount 9000 is BLOCKED because it exceeds approvalAmount
```

## 3. Run the attack lab

```bash
npx agentgate attack
```

The lab exercises representative destructive, export, escalation, and high-value actions through the same gateway path used at runtime.

## 4. Start the local control plane

```bash
npx agentgate dev
```

Then open `http://localhost:8787`. Local development creates a short-lived browser session automatically; production authentication remains required.

The dashboard starts with seeded ALLOW / ASK / BLOCK demo runs so you can verify the control plane before connecting your own agent.

Useful endpoints include:

- `/api/health` — process health
- `/api/ready` — readiness state
- `/api/metrics` — runtime telemetry
- `/api/runs` — replayable runs
- `/api/approvals` — pending approvals
- `/api/behavior` — behavior signals
- `/api/blast-radius` — blast-radius analysis

## 5. Start from the CLI

```bash
npx agentgate init
```

This creates `agentgate.config.mjs` with a conservative production policy baseline.

## 6. Recommended rollout

1. Start in `observe` mode.
2. Run your normal agent traffic.
3. Run `agentgate attack` and your own abuse cases.
4. Review replay IDs, behavior signals, and generated reports.
5. Activate reviewed policies.
6. Switch to `enforce` mode for production side effects.
7. Keep approvals and audit events connected to your operational workflow.

AgentGate is a control layer, not a guarantee that an agent is safe. Test the actions and tools that matter to your application.


## Approval lifecycle for `createAgentGate`

When a protected SDK tool returns `approval_required`, the returned `approvalId` is resolved through the same gate:

```js
const result = await refund({ amount: 900 });
if (result.status === 'approval_required') {
  const approved = await gate.approve(result.approvalId);
  // or: await gate.deny(result.approvalId, 'Not authorized');
}
```

You can inspect pending requests with `gate.approvals()` and retrieve one with `gate.getApproval(approvalId)`. The approval API executes the original protected tool only after explicit approval.
