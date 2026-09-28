# Contributing to AgentGate

## Development

```bash
npm install
npm test
```

Keep security decisions deterministic. Do not introduce an LLM as the sole authority for `ALLOW`, `ASK`, or `BLOCK`.

## Pull requests

Please include:

- a focused change
- tests for new behavior
- documentation when the developer-facing API changes
- security considerations for authorization or tool-execution changes

Run the full test suite before submitting a pull request.
