import os from 'node:os';
import { performance } from 'node:perf_hooks';
import { createRuntime } from '../src/runtime.js';

const samples = Number(process.env.AG_BENCH_SAMPLES || 5000);
const concurrency = Number(process.env.AG_BENCH_CONCURRENCY || 100);
const policies = { productionBlock: true, approvalAmount: 5000, autoApproveAmount: 500 };
const gate = createRuntime({ mode: 'enforce', policies });

const percentile = (values, p) => {
  const sorted = [...values].sort((a, b) => a - b);
  const i = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[i];
};

async function run(label, fn) {
  const durations = [];
  let errors = 0;
  const started = performance.now();
  let next = 0;
  async function worker() {
    while (true) {
      const i = next++;
      if (i >= samples) return;
      const t = performance.now();
      try { await fn(i); } catch { errors++; }
      durations.push(performance.now() - t);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, samples) }, () => worker()));
  const elapsed = performance.now() - started;
  return {
    label,
    samples,
    concurrency,
    errors,
    p50_ms: Number(percentile(durations, 50).toFixed(3)),
    p95_ms: Number(percentile(durations, 95).toFixed(3)),
    p99_ms: Number(percentile(durations, 99).toFixed(3)),
    throughput_ops_sec: Number((samples / (elapsed / 1000)).toFixed(2))
  };
}

const allow = await run('ALLOW check', i => gate.check({ agent: 'bench', tool: 'read', action: 'read', input: { id: i } }));
const block = await run('BLOCK check', i => gate.check({ agent: 'bench', tool: 'delete', action: 'delete', input: { id: i } }));
const execute = await run('ALLOW execute', i => gate.execute(async () => ({ ok: true, i }), { agent: 'bench', tool: 'read', action: 'read', input: { id: i } }));

console.log(JSON.stringify({
  agentgateVersion: (await import('../package.json', { with: { type: 'json' } })).default.version,
  node: process.version,
  platform: `${process.platform}-${process.arch}`,
  cpu: os.cpus()[0]?.model || 'unknown',
  memory_gb: Number((os.totalmem() / 1024 ** 3).toFixed(2)),
  policy: policies,
  results: [allow, block, execute],
  note: 'Environment-specific benchmark; do not treat as an SLA.'
}, null, 2));
