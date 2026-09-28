import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

function runCli(args, cwd) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [fileURLToPath(new URL('../bin/agentgate.js', import.meta.url)), ...args], { cwd });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', d => { stdout += d; });
    child.stderr.on('data', d => { stderr += d; });
    child.on('close', code => resolve({ code, stdout, stderr }));
  });
}

test('partner init creates the five-step operating kit', async () => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'agentgate-partner-'));
  const result = await runCli(['partner', 'init', 'support-refund-safety'], cwd);
  assert.equal(result.code, 0);
  for (const file of ['partner-intake.md', 'pilot-plan.md', 'acceptance-scorecard.md', 'exit-report.md']) {
    await fs.access(path.join(cwd, 'design-partner', file));
  }
});

test('partner check passes only when every critical gate is green', async () => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'agentgate-partner-check-'));
  const report = {
    blockSideEffects: 0,
    askPreApprovalExecutions: 0,
    approvedExecutions: 1,
    crossTenantLeaks: 0,
    undetectedEgressSecrets: 0,
    auditMismatches: 0,
    replayAfterRestart: true
  };
  const file = path.join(cwd, 'report.json');
  await fs.writeFile(file, JSON.stringify(report));
  const result = await runCli(['partner', 'check', file], cwd);
  assert.equal(result.code, 0);
  assert.equal(JSON.parse(result.stdout).ready, true);
});

test('partner check fails on a critical gate', async () => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'agentgate-partner-check-fail-'));
  const report = {
    blockSideEffects: 1,
    askPreApprovalExecutions: 0,
    approvedExecutions: 1,
    crossTenantLeaks: 0,
    undetectedEgressSecrets: 0,
    auditMismatches: 0,
    replayAfterRestart: true
  };
  const file = path.join(cwd, 'report.json');
  await fs.writeFile(file, JSON.stringify(report));
  const result = await runCli(['partner', 'check', file], cwd);
  assert.equal(result.code, 2);
  assert.equal(JSON.parse(result.stdout).ready, false);
});
