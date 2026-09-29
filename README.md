# AgentGate v2.13.8 — First-Client Hardening

**The runtime control plane for AI agents.**

AgentGate sits between an agent and its tools and makes runtime decisions:

`ALLOW` → execute · `ASK` → require approval · `BLOCK` → stop

### Security-aware observability

AgentGate does not attempt to replace generic tracing platforms. Its observability layer joins runtime behavior to the controls that protect the agent:

- Unified trace: LLM → tool → policy → approval → execution → egress → behavior → cost
- Deterministic Agent Efficiency Score with transparent breakdown
- Behavior × Cost × Security correlation
- Cost analytics by agent, model, tool, action, tenant and customer/user
- Security cost: blocked calls, approvals, attack tests and egress blocks
- Deterministic month-end cost forecast from month-to-date run-rate
- Cost Guardrails can produce ALLOW / ASK / BLOCK decisions before tool execution

Useful control-plane endpoints include `/api/observability`, `/api/trace?runId=...`, `/api/efficiency`, `/api/behavior/correlation`, `/api/cost/analytics`, and `/api/cost/forecast`.

## Developer loop

**Observe → Attack → Enforce → Replay → Report → Govern**


## Design Partner Edition

AgentGate 2.13.8 focuses on controlled design-partner adoption before public marketing. Start with one sensitive tool, use Observe/Shadow mode, then move to Enforce only after the acceptance gates pass.

```bash
npm install agentgate-runtime-control
npx agentgate pack list
npx agentgate pack test support-refund-safety
npx agentgate attack
npx agentgate demo refund
npx agentgate doctor
npx agentgate simulate
npx agentgate validate-security
npx agentgate dev
```

Then read [`docs/quickstart.md`](docs/quickstart.md) for the recommended observe → attack → enforce rollout, or [`docs/design-partner.md`](docs/design-partner.md) for the first-partner workflow.

### Docker

```bash
docker build -t agentgate .
docker run --rm -p 8787:8787 agentgate
```

### Examples

- `examples/protect-first-tool.mjs` — protect four real tools in one file (`read_customer` → ALLOW, `delete_customer` → ASK, `refund` → ASK/BLOCK by amount, `export_all` → BLOCK). Start here.
- `examples/refund-agent.mjs` — protect a real side-effecting refund tool.
- `examples/policy-bundle.mjs` — test and activate a versioned policy bundle.

### Test your own tools against Attack Lab

By default, `agentgate attack` runs the built-in attack scenarios against AgentGate's default policies. To test them against **your own** `agentgate.config.mjs` (the policies you actually ship with), pass `--config`:

```bash
agentgate attack --config ./agentgate.config.mjs
```

The config file must export an `agentgate` object created with `createAgentGate()` (exactly what `agentgate init` generates).

## Production readiness

See [`docs/production-readiness.md`](docs/production-readiness.md), [`docs/production-deployment.md`](docs/production-deployment.md), and [`docs/release-checklist.md`](docs/release-checklist.md) for deployment, operational, performance, and release gates.

## Security

See [`SECURITY.md`](SECURITY.md) for the security model and vulnerability-reporting guidance. AgentGate provides a deterministic control layer; it does not replace application-level identity, secret management, network isolation, or threat-model testing.

## Agent Observability

AgentGate adds security-aware observability on top of the same runtime runs used for enforcement and replay. It reports decision counts, success/error rates, P50/P95/P99 latency, tool/agent/model breakdowns, unified security traces, deterministic Agent Efficiency scores, behavior×cost×security correlation, cost analytics, and deterministic cost forecasting.

```js
const gateway = createMCPGateway({
  pricing: {
    'my-model': { inputPer1M: 1, outputPer1M: 2, cachedInputPer1M: 0.25 }
  }
});

const report = gateway.observability.analyze(gateway.runs());
console.log(report.latency.p95);
console.log(report.security);
console.log(report.cost);
```

Pricing is intentionally explicit and provider-neutral because model pricing changes over time.

## Cost Control

Cost thresholds can become runtime controls instead of passive dashboard alerts:

```js
const gateway = createMCPGateway({
  budgets: {
    daily: { ask: 50, hard: 100 },
    monthly: { ask: 1000, hard: 1500 }
  }
});
```

When an estimated action cost crosses `ask`, AgentGate enters the normal approval path. When it crosses `hard`, the action is blocked. The control is deterministic and separate from the security policy engine.

The Control Plane exposes `/api/observability`, `/api/trace`, `/api/efficiency`, `/api/behavior/correlation`, `/api/cost`, `/api/cost/analytics`, `/api/cost/forecast`, `/api/cost/pricing`, and `/api/cost/budgets`.


## Install

```bash
npm install agentgate-runtime-control
```

## Protect a tool

```js
import { protect } from 'agentgate-runtime-control';

const refund = protect(myRefundTool, {
  approvalActions: ['refund'],
  approvalAmount: 5000
});
```

## Runtime

```js
import { createRuntime } from 'agentgate-runtime-control';

const gate = createRuntime({
  mode: 'enforce',
  policies: { productionBlock: true }
});

await gate.execute(myTool, {
  agent: 'support-agent',
  tool: 'delete_customer',
  action: 'delete',
  environment: 'production'
});

console.log(gate.runs());
```

Observe mode records what AgentGate **would** block/ask without interrupting production. Enforce mode applies the decision.

## Attack Lab

```js
import { runAttackLab } from 'agentgate-runtime-control';
console.table(runAttackLab({ productionBlock: true }));
```

The built-in lab covers prompt injection, privilege escalation, destructive actions, high-value refunds, and unsafe tool chaining. It is a testing aid, not a guarantee of security.

## CLI

```bash
agentgate test refund 1200
agentgate attack
```

## MCP Gateway

AgentGate can now sit between an MCP client/agent and tool handlers. It supports MCP-style JSON-RPC methods for `initialize`, `ping`, `tools/list`, and `tools/call`.

```js
import { createMCPGatewayServer } from 'agentgate-runtime-control/mcp-gateway';

const { server } = createMCPGatewayServer({
  mode: 'enforce',
  policies: { blockActions: ['export_all'] },
  tools: [{ name: 'read', handler: async () => 'ok' }]
});
server.listen(8787);
```

Every tool call is evaluated before execution and recorded with a run ID, decision, risk, reason, and execution result/error. In `observe` mode, risky calls are recorded but still execute, making it possible to test policies before enforcement.

Run the example with:

```bash
node examples/mcp-gateway.mjs
```

## MCP Gateway Attack Lab

AgentGate can now execute its built-in attack scenarios through the MCP gateway itself:

```js
import { createMCPGateway, runGatewayAttackLab } from 'agentgate-runtime-control';

const gateway = createMCPGateway({
  mode: 'enforce',
  policies: { productionBlock: true },
  tools: [
    { name: 'refund', handler: async (input) => refundCustomer(input) },
    { name: 'delete', handler: async (input) => deleteWorkspace(input) },
    { name: 'export_all', handler: async (input) => exportRecords(input) }
  ]
});

const results = await runGatewayAttackLab(gateway);
```

Each scenario is sent through the same authorization path used by real MCP calls. Results include the decision, risk, replay run ID, and whether the gateway prevented or paused the attack.

> Attack Lab is a controlled testing aid. Passing the built-in scenarios is not a security guarantee.

## Policy Builder

Turn Attack Lab results into reviewable policy suggestions:

```js
import { generatePolicySuggestions, mergePolicies } from 'agentgate-runtime-control';

const report = await runGatewayAttackLab(gateway);
const generated = generatePolicySuggestions(report);
const nextPolicy = mergePolicies(currentPolicy, generated.policy);
```

Policy generation is deterministic and reviewable. Generated suggestions do not automatically authorize or block traffic until the resulting policy is explicitly applied to a gateway.


## Approval Flow

Sensitive tool calls that evaluate to `ASK` enter a pending approval state and are never executed automatically in enforce mode.

```js
const result = await gateway.handle({
  jsonrpc: '2.0',
  id: 1,
  method: 'tools/call',
  params: { name: 'refund', action: 'refund', arguments: { amount: 1200 } }
});

const approvalId = result.result._agentgate.approvalId;
const approved = await gateway.approve(approvalId);
// approved.status === 'executed'
```

You can also deny with an auditable reason:

```js
await gateway.deny(approvalId, 'Not authorized for this request');
```

Approval state is queryable through `gateway.approvals()` and JSON-RPC methods:
- `agentgate/approvals/list`
- `agentgate/approvals/approve`
- `agentgate/approvals/deny`

The approval layer is intentionally separate from policy evaluation: policy decides `ALLOW`, `ASK`, or `BLOCK`; approval resolves only the `ASK` path.

## v1.1 — Developer Integration

AgentGate now exposes a single developer-facing runtime:

```js
import { createAgentGate } from 'agentgate-runtime-control';

const gate = createAgentGate({
  agent: 'SupportBot',
  mode: 'enforce',
  policies: { productionBlock: true }
});

const refund = gate.protect(
  async ({ amount }) => ({ refunded: amount }),
  { tool: 'refund', action: 'refund' }
);

const result = await refund({ amount: 900 });
```

The protected tool receives deterministic `ALLOW`, `ASK`, or `BLOCK` decisions. In `observe` mode risky actions are executed but recorded as simulated decisions.

### CLI

```bash
npx agentgate init
npx agentgate doctor
npx agentgate simulate
npx agentgate validate-security
npx agentgate dev
npx agentgate test refund 900
npx agentgate attack
```

`agentgate dev` starts the local Control Plane at `http://localhost:8787`.

### MCP

Use `gate.withMCP()` to create an AgentGate-protected MCP gateway while keeping policy evaluation and approval handling in the same runtime.


## Attack Runner

Run the built-in attacks through the real MCP gateway:

```bash
agentgate attack
```

The runner records replayable run IDs and reports blocked, approval-required, and allowed outcomes. A non-zero exit code indicates at least one attack was not prevented.

## Behavior Detection & Blast Radius (v1.4)

AgentGate can analyze recorded runtime activity for deterministic behavior patterns such as suspicious tool chaining, repeated controlled actions, escalation attempts, and broad data access attempts. It also estimates blast radius from request metadata including scope, target count, environment, privilege, destructive behavior, exports, and transaction value. These are risk-analysis signals, not guarantees of actual impact.

```js
const behavior = gate.behavior();
const blastRadius = gate.blastRadius();
```

The control plane exposes:
- `GET /api/behavior`
- `GET /api/blast-radius`

Security reports now include `behavior` and `blastRadius` sections.


## Persistent Control Plane (v1.5)

AgentGate can persist runtime state without requiring a hosted database:

```js
const gate = createAgentGate({
  agent: 'CheckoutAgent',
  mode: 'enforce',
  persistence: '.agentgate',
  policies: { productionBlock: true }
});
```

Persistent state includes runs and approvals. The control plane also exposes an agent registry:

- `GET /api/agents`
- `POST /api/agents/register` with `{ "name": "CheckoutAgent", "environment": "production" }`

The storage layer is an adapter, so a later Postgres/Supabase implementation can replace the local JSON store without changing the security API.

## Identity & Authorization

AgentGate v1.6 adds deterministic runtime authorization based on agent/user identity, roles, attributes, actions, tools, resources, and environment. Authorization is evaluated before the existing risk/policy engine. Explicit denies win, and configured authorization can use deny-by-default.

```js
const gateway = createMCPGateway({
  policies: {
    authorization: {
      requireIdentity: true,
      rules: [
        { id: "billing-refunds", effect: "allow", roles: ["billing"], actions: ["refund"] },
        { id: "deny-production", effect: "deny", resources: ["production/*"] }
      ]
    }
  }
});
```

The authorization result is included in the run audit record so operators can see the identity, matched rule, and reason for an allow/block decision.



## Policy Management & Versioning (v1.7)

Policies are first-class, versioned artifacts. Versions are immutable after testing/activation and move through:

`draft → tested → active → archived`

```js
import { createPolicyRegistry } from 'agentgate-runtime-control/policy-registry';

const registry = createPolicyRegistry({ filePath: '.agentgate/policies.json' });
const v1 = registry.create('payments', {
  autoApproveAmount: 500,
  approvalAmount: 5000,
  blockActions: ['export_all']
});

registry.test('payments', v1.version, [
  { input: { action: 'export_all' }, expected: 'BLOCK' },
  { input: { action: 'refund', amount: 200 }, expected: 'ASK' }
]);

registry.activate('payments', v1.version);
```

The registry supports:
- immutable versions
- deterministic policy tests
- diff between versions
- activation and rollback
- persistent audit history

The Control Plane exposes policy management through `/api/policies`, `/api/policies/create`, `/api/policies/test`, `/api/policies/activate`, `/api/policies/rollback`, `/api/policies/diff`, and `/api/policies/audit`.

CLI examples:

```bash
agentgate policy create payments '{"blockActions":["refund"]}'
agentgate policy list payments
agentgate policy test payments 1 '[{"input":{"action":"refund"},"expected":"BLOCK"}]'
agentgate policy activate payments 1
agentgate policy diff payments 1 2
```

The active policy is synchronized into the gateway before it evaluates subsequent tool calls.

## Identity & Authorization

AgentGate supports deterministic RBAC and ABAC authorization using agent/user identity, roles, attributes, resource, action, tool, and environment. Explicit deny and deny-by-default can be enforced before normal risk policy evaluation.

## Persistence

Runs, approvals, agents, and policy versions can be persisted locally through the built-in storage adapters. For production multi-tenant deployments, use the Postgres/Supabase adapters with tenant-scoped sessions and RLS; local JSON persistence is intended for development or single-process deployments. Storage is provider-neutral so a database adapter can be introduced without changing the policy API.

## Multi-Tenant Control Plane (v1.8)
AgentGate v1.8 adds tenant isolation, scoped API keys, key rotation/revocation, and tenant-scoped webhook registrations.

### Tenant CLI
```bash
agentgate tenant create Acme
agentgate tenant list
agentgate tenant key <tenant-id> runs:read,policies:read
agentgate tenant rotate <key-id>
agentgate tenant revoke <key-id>
```

### API key security
- API key secrets are returned only at issuance/rotation and are stored as SHA-256 hashes.
- Keys support expiry, revocation, rotation, and scoped permissions.
- Tenant ID is part of the authorization boundary; a valid key for tenant A cannot authorize access to tenant B.

### Webhooks
Webhooks are tenant-scoped and event-filtered. AgentGate records delivery attempts with event, payload, status, and attempt metadata for later delivery workers.


## Production Hardening (v2.1)
- API-key authentication middleware with tenant binding and scope enforcement
- Real signed webhook delivery with timeout/retry metadata
- Postgres storage adapter and Supabase adapter hooks
- Portable Postgres schema with tenant index and RLS enabled
- Invalid JSON handling and fail-closed protected control-plane routes

### HTTP authentication
Send `Authorization: Bearer <agentgate-key>` or `X-AgentGate-Key: <agentgate-key>`.
Use `X-AgentGate-Tenant` when explicitly selecting a tenant; mismatches are rejected.

For first-tenant bootstrap over HTTP, set `AGENTGATE_BOOTSTRAP_TOKEN` and send `X-AgentGate-Bootstrap` on the first `/api/tenants/create` request. After the first tenant exists, normal API-key authentication applies.


## Enterprise Runtime v2.1
- Multi-tenant runtime control plane
- Scoped API keys and production authentication
- Signed webhooks with retries
- PostgreSQL/Supabase adapters
- Runtime event bus and real-time event subscriptions
- Atomic policy bundles with test-before-activate
- OIDC claim mapping and tenant-bound identity
- Administrative RBAC for owner/admin/operator/viewer roles
- Deterministic authorization remains the security authority


### Production Operations v2.1
- `/api/health` and `/api/ready` health/readiness probes
- `/api/metrics` deterministic runtime counters and latency telemetry
- `/api/events` Server-Sent Events stream for runtime events
- Sliding-window HTTP rate limiting with 429 responses
- OIDC JWT signature, issuer, audience, expiry, and not-before validation for HS256/RS256/ES256
- Telemetry and event bus are exposed through the SDK

## Security hardening in v2.4

For authenticated multi-tenant deployments, AgentGate treats the authenticated tenant identity as authoritative. Runtime runs and approvals carry `tenantId` and Control Plane reads, replay, approvals, behavior analysis, blast-radius analysis, webhooks and SSE are tenant-scoped. Request-body or query-string tenant overrides are rejected.

The MCP HTTP server is local-only by default. Non-local deployment requires an authentication hook. HTTP request bodies are size-limited. Webhook delivery blocks loopback, private, link-local and metadata targets, resolves DNS before delivery, and rejects redirects.

## Response / Data Egress Guard (2.8)

Protects the boundary between tools and agents. Enable it on the MCP gateway:

```js
const gateway = createMCPGateway({
  egress: {
    // default: sensitive credentials BLOCK, PII REDACT
  },
  tools: [/* ... */]
});
```

The guard detects common API keys, private keys, bearer tokens, JWTs, emails, phone numbers, and card-like values. Findings are deterministic and produce `ALLOW`, `REDACT`, or `BLOCK` decisions. Custom rules can change the action for a finding type. Egress decisions are recorded on the run and emitted as `egress.blocked` / `egress.redacted` events.

For direct use:

```js
import { createEgressGuard } from 'agentgate-runtime-control';
const guard = createEgressGuard();
const result = guard.guard(toolResult);
```

## Response / Data Egress Guard (2.8)

Protect the boundary between tools and agents. Enable it on the MCP gateway:

```js
const gateway = createMCPGateway({
  egress: {},
  tools: [/* ... */]
});
```

The deterministic guard detects common API keys, private keys, bearer tokens, JWTs, email addresses, phone numbers, and card-like values. Findings produce `ALLOW`, `REDACT`, or `BLOCK` decisions. Credentials default to `BLOCK`; common PII defaults to `REDACT`. Rules can be overridden per finding type.

```js
import { createEgressGuard } from 'agentgate-runtime-control';
const guard = createEgressGuard();
const result = guard.guard(toolResult);
```

MCP runs record egress decisions and emit `egress.blocked` / `egress.redacted` runtime events.


## Preflight and Security Validation

Before exposing an agent to real traffic, run:

```bash
agentgate doctor
agentgate simulate
agentgate validate-security
```

`doctor` validates configuration and fail-closed deployment assumptions. `simulate` shows the deterministic decision matrix before execution. `validate-security` runs the built-in runtime attack, pre-execution blocking, approval boundary, egress detection, malformed-input resilience and tenant-isolation checks.


## Security hardening

The default egress guard blocks and redacts generic sensitive fields such as `secret`, `password`, `private_key`, `access_token`, and `authorization`. See `docs/security-hardening-release-report.md` and the external/managed-PostgreSQL test packs.
