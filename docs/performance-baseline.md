# Performance Baseline — 2.13.8

Measured with `npm run benchmark` on the release build.

Environment:

```text
Node: v22.16.0
OS/arch: linux-x64
CPU: Intel(R) Xeon(R) Platinum 8370C CPU @ 2.80GHz
Memory: 5.81 GB
Samples: 5,000 per workload
Concurrency: 100
Policy: productionBlock=true, approvalAmount=5000, autoApproveAmount=500
```

| Workload | P50 | P95 | P99 | Throughput |
|---|---:|---:|---:|---:|
| ALLOW check | 2.323 ms | 5.225 ms | 7.570 ms | 35,915.98 ops/s |
| BLOCK check | 2.239 ms | 5.168 ms | 8.393 ms | 40,660.09 ops/s |
| ALLOW execute | 1.577 ms | 6.573 ms | 28.485 ms | 39,524.91 ops/s |

These figures are an environment-specific baseline, not an SLA. Database persistence, network calls, model latency, egress inspection configuration, policy size and deployment topology can materially change end-to-end latency.
