# AgentGate Design Partner Rollout

This is the controlled path from a tested AgentGate build to a production candidate.
It is intentionally narrower than a general AI-security launch.

## Ten-stage rollout

1. **Freeze a tested baseline** — start from a release that passed an external consumer-project test.
2. **Fast first protection** — install, initialize, simulate, attack, and protect one tool without building a control plane first.
3. **Policy Pack** — start with one job-specific pack and declared test cases.
4. **Shadow Mode** — record what AgentGate would ALLOW/ASK/BLOCK while the existing tool still executes.
5. **Design Partner** — use 3–5 partners, one agent and one sensitive tool per partner initially.
6. **Enforce** — move one validated sensitive tool from shadow to enforcement.
7. **Evidence** — require request, decision, winning rule, rule trace, execution outcome, and replay evidence.
8. **Case Study** — measure before/after outcomes using partner-approved data.
9. **Productize** — extract repeated policy patterns, integrations, and onboarding friction into the product.
10. **Commercialize** — only after repeatable protection and onboarding evidence exists.

## Partner acceptance gates

- `BLOCK -> handler execution = 0`
- `ASK -> pre-approval execution = 0`
- Approved `ASK -> exactly 1 execution`
- Cross-tenant access -> `0` leaks
- Egress secret leakage -> `0` undetected test cases
- Audit mismatch -> `0`
- Restart/replay -> evidence remains available
- Time to first protected tool -> target under 10 minutes

## Rollout sequence

`replay/sandbox -> shadow -> low-risk enforce -> sensitive-tool enforce`

Do not start with sensitive production data. Review the partner's tool contract,
identity model, and existing authorization before enforcement.
