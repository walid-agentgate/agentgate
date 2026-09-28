# Security Policy

## Reporting a vulnerability

Please do not disclose exploitable vulnerabilities in a public issue. Use the project's private security reporting channel once the repository is published, or contact the maintainers directly.

Include:

- affected version
- affected component or endpoint
- reproduction steps
- security impact
- suggested mitigation, if known

## Security model

AgentGate is designed so authorization decisions are deterministic and policy-driven. The model is not the authorization authority. Sensitive actions can be blocked or paused for approval before a tool handler executes.

AgentGate is not a security guarantee. Applications remain responsible for identity, secrets, network isolation, tool implementation, data handling, and testing their own threat model.
