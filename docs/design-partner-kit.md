# AgentGate Design Partner Kit

This kit is the controlled operating package for a 3–5 partner pilot. It is not a general security or compliance program.

## 1. Select one workflow

Start with one agent and one side-effecting tool. Recommended first workflow: Support Refund Safety.

- Agent: support/operations agent
- Sensitive tool: `refund`
- Initial environment: sandbox or replay
- Policy Pack: `support-refund-safety`

## 2. Run the five-step pilot

1. **Intake** — document the agent, tool, side effects, identity/tenant model, and existing authorization.
2. **Sandbox / replay** — install AgentGate from the real package and replay representative traffic.
3. **Shadow** — record proposed decisions and compare them with actual execution. Do not enforce until mismatches are reviewed.
4. **Enforce** — enable one sensitive tool only after the acceptance gates pass.
5. **Evidence / exit** — preserve Run, winningRule, ruleTrace, execution result, egress findings, and Replay evidence; complete the exit report.

## 3. Acceptance gates

- `BLOCK -> handler execution = 0`
- `ASK -> pre-approval execution = 0`
- approved `ASK -> exactly 1 execution`
- cross-tenant access -> `0` leaks
- undetected egress secret findings -> `0`
- audit mismatch -> `0`
- restart/replay -> PASS
- first protected tool -> target under 10 minutes

## 4. Partner evidence package

Every pilot should produce:

- policy pack and test cases
- shadow report
- attack results
- enforcement results
- approval evidence
- replay run IDs
- restart verification
- before/after metrics
- limitations and unresolved controls

## 5. Exit decision

A pilot is **ready** only when every critical gate is green and the partner explicitly accepts the evidence. Otherwise keep the tool in shadow mode and resolve the failing gate.

AgentGate does not claim to prevent every prompt-injection technique and does not replace application authorization, IAM, network isolation, or provider controls.
