# Performance Benchmark

AgentGate security tests and performance benchmarks are separate concerns. A concurrency/security test proves correctness under load; it is not a latency SLA.

Run:

```bash
npm run benchmark
```

The benchmark reports P50/P95/P99 latency and throughput for deterministic `check()` decisions and an execution path. Results are environment-specific and must be rerun on the customer's target infrastructure before publishing an SLA.

## What to record

- Node version
- CPU / memory
- AgentGate version
- policy size/type
- concurrency
- sample count
- P50/P95/P99
- throughput
- error count

## Release policy

No universal latency number is promised by AgentGate. A customer-facing performance claim must cite the exact benchmark environment and policy workload.
