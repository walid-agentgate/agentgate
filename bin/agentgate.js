#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { evaluate } from '../src/policy-engine.js';
import { createAgentGate } from '../src/agentgate.js';
import { createControlPlane } from '../src/control-plane.js';
import { runGatewayAttackLab, runDeepAttackLab, summarizeAttackResults } from '../src/attack-lab.js';
import { createMCPGateway } from '../src/mcp-gateway.js';
import { generateSecurityReport, renderSecurityReportHTML } from '../src/security-report.js';
import { createPolicyRegistry } from '../src/policy-registry.js';
import { TenantRegistry } from '../src/multi-tenant.js';
import { scanMCPTools, createToolTrustStore } from '../src/mcp-scanner.js';
import { guardEgress } from '../src/egress-guard.js';
import { validateAgentGateConfig, simulatePolicyMatrix, runDoctorChecks } from '../src/local-experience.js';
import { runSecurityValidation } from '../src/security-validation.js';
import { listPolicyPacks, getPolicyPack, getDefaultPolicyPack } from '../src/policy-packs.js';
import { analyzeShadowEvents } from '../src/shadow-mode.js';

const require = createRequire(import.meta.url);
const PACKAGE_VERSION = require('../package.json').version;

const [cmd, action='read', amount='0'] = process.argv.slice(2);
const showHelp = () => console.log(`AgentGate ${PACKAGE_VERSION} — Runtime Control Plane

Usage:
  agentgate init
  agentgate dev [--port <port>]
  agentgate test <action> [amount]
  agentgate attack [--config <path>] [--deep]
  agentgate attack-ci [--deep]
  agentgate report
  agentgate scan <tools.json> [--strict]
  agentgate egress <response.json> [--strict]
  agentgate policy <create|list|test|activate|rollback|diff> <name> ...
  agentgate tenant <create|list|key|revoke|rotate> ...
  agentgate approval <list|approve|deny> [id] [reason] [--url <url>] [--key <apiKey>]
  agentgate --help
  agentgate doctor
  agentgate simulate
  agentgate validate-security
  agentgate pack <list|show|init|test> [pack-id]
  agentgate shadow <events.json>
  agentgate partner init [pack]
  agentgate partner check <report.json>
  agentgate demo refund
  agentgate --help
  agentgate --version`);
if (cmd === '--help' || cmd === '-h' || cmd === 'help') { showHelp(); process.exit(0); }
if (cmd === '--version' || cmd === '-v' || cmd === 'version') { console.log(PACKAGE_VERSION); process.exit(0); }

if (cmd === 'pack') {
  const sub = process.argv[3] || 'list';
  if (sub === 'list') console.log(JSON.stringify(listPolicyPacks(), null, 2));
  else if (sub === 'show') {
    const id = process.argv[4] || 'support-refund-safety';
    const pack = getPolicyPack(id);
    if (!pack) { console.error(`Unknown policy pack: ${id}`); process.exitCode = 1; }
    else console.log(JSON.stringify(pack, null, 2));
  } else if (sub === 'init') {
    const id = process.argv[4] || 'support-refund-safety';
    const pack = getPolicyPack(id);
    if (!pack) { console.error(`Unknown policy pack: ${id}`); process.exitCode = 1; }
    else {
      const file = path.resolve(process.cwd(), 'agentgate.config.mjs');
      const content = `import { createAgentGate, getPolicyPack } from 'agentgate-runtime-control';

const pack = getPolicyPack('${pack.id}');

export const agentgate = createAgentGate({
  agent: 'SupportAgent',
  mode: 'enforce',
  policies: pack.policies
});

export { pack };
`;
      try { await fs.access(file); console.error('agentgate.config.mjs already exists'); process.exitCode = 1; }
      catch { await fs.writeFile(file, content, 'utf8'); console.log(`Created ${file} from ${pack.name} (enforce mode)`); }
    }
  } else if (sub === 'test') {
    const id = process.argv[4] || 'support-refund-safety';
    const pack = getPolicyPack(id);
    if (!pack) { console.error(`Unknown policy pack: ${id}`); process.exitCode = 1; }
    else {
      const results = simulatePolicyMatrix({ policies: pack.policies, cases: pack.cases });
      const passed = results.filter((x, i) => x.decision === pack.cases[i].expected).length;
      console.log(JSON.stringify({ pack: pack.id, total: results.length, passed, failed: results.length - passed, results }, null, 2));
      if (passed !== results.length) process.exitCode = 2;
    }
  } else { console.error('Usage: agentgate pack <list|show|init|test> [pack-id]'); process.exitCode = 1; }
} else if (cmd === 'demo' && process.argv[3] === 'refund') {
  const pack = getDefaultPolicyPack();
  const gate = createAgentGate({ agent: 'SupportAgent', mode: 'enforce', policies: pack.policies });
  let executions = 0;
  const refund = gate.protect(async input => { executions += 1; return { refunded: input.amount, customerId: input.customerId }; }, { tool: 'refund', action: 'refund' });
  console.log(`\nAgentGate — ${pack.name} v${pack.version}`);
  console.log('Policy: refund → ASK | > $5,000 → BLOCK | invalid amounts → BLOCK');
  for (const [amount, label] of [[250, 'small-refund'], [1200, 'review-refund'], [5000.01, 'over-ceiling'], ['5000.01', 'invalid-string']]) {
    try {
      const result = await refund({ amount, customerId: 'demo_customer' }, { amount });
      console.log(JSON.stringify({ case: label, amount, status: result.status, decision: result.agentgate?.decision, winningRule: result.agentgate?.winningRule, executionCount: executions }));
    } catch (error) {
      console.log(JSON.stringify({ case: label, amount, status: 'blocked', decision: error.agentgate?.decision, winningRule: error.agentgate?.winningRule, executionCount: executions }));
    }
  }
  console.log(JSON.stringify({ proof: 'blocked actions did not execute', refundExecutions: executions }, null, 2));
} else if (cmd === 'doctor') {
  const configPath = path.resolve(process.cwd(), 'agentgate.config.mjs');
  let config = { mode: 'enforce', policies: { productionBlock: true, autoApproveAmount: 500, approvalAmount: 5000 }, authRequired: true };
  let foundConfig = false;
  try { const mod = await import(`file://${configPath}?doctor=${Date.now()}`); const gate = mod.agentgate || {}; config = { ...config, ...(mod.config || {}), ...(gate.config || {}), ...(gate.mode ? { mode: gate.mode } : {}), ...(gate.policies ? { policies: gate.policies } : {}) }; foundConfig = true; } catch {}
  const report = runDoctorChecks({ config });
  console.log(JSON.stringify(report, null, 2));
  if (!foundConfig) {
    console.error('\nNo agentgate.config.mjs found here — checked built-in defaults instead. Run `agentgate init` first to create one for your own policies.');
  }
  if (config.mode === 'observe') {
    console.error('\n⚠️  WARNING: mode is "observe". Decisions are being recorded but NOTHING is actually blocked or held for approval yet — destructive tools will still execute. Set mode: \'enforce\' in agentgate.config.mjs once you are ready to protect real tools.');
  }
  const effectiveUnknownActionPolicy = config.policies?.unknownActionPolicy || 'ask';
  if (effectiveUnknownActionPolicy === 'allow') {
    console.error("\n❌ ERROR: policies.unknownActionPolicy is explicitly 'allow'. Enforce-mode configurations must use 'ask' or 'block' so unrecognized actions cannot silently execute.");
  }
  if (report.ok) {
    console.error('\nNext: protect your first tool — see examples/protect-first-tool.mjs for a worked example (read/delete/refund/export), or run `agentgate attack --config agentgate.config.mjs` to test your policy against the built-in attack scenarios.');
  } else {
    console.error('\nFix the failing checks above, then run `agentgate doctor` again.');
  }
  process.exitCode = report.ok ? 0 : 2;
} else if (cmd === 'simulate') {
  const policy = { productionBlock: true, autoApproveAmount: 500, approvalAmount: 5000 };
  console.log(JSON.stringify(simulatePolicyMatrix({ policies: policy }), null, 2));
} else if (cmd === 'partner') {
  const sub = process.argv[3] || 'help';
  if (sub === 'init') {
    const packId = process.argv[4] || 'support-refund-safety';
    const pack = getPolicyPack(packId);
    if (!pack) { console.error(`Unknown policy pack: ${packId}`); process.exitCode = 1; }
    else {
      const dir = path.resolve(process.cwd(), 'design-partner');
      await fs.mkdir(dir, { recursive: true });
      const files = {
        'partner-intake.md': `# Design Partner Intake\n\n- Partner: \n- Agent: \n- Sensitive tool: \n- Environment: sandbox / replay / production\n- Identity/tenant model: \n- Existing authorization: \n- Side effects: \n- Contact: \n\n## Success criteria\n- BLOCK -> 0 handler execution\n- ASK -> 0 pre-approval execution\n- Approved ASK -> exactly 1 execution\n- Cross-tenant access -> 0 leaks\n- Egress secret leakage -> 0 undetected test cases\n- Audit mismatch -> 0\n`,
        'pilot-plan.md': `# Design Partner Pilot Plan\n\n## Phase 1 — Sandbox / Replay\nInstall the real AgentGate package and replay representative traffic.\n\n## Phase 2 — Shadow\nRecord proposed ALLOW/ASK/BLOCK decisions while existing execution continues. Review every mismatch.\n\n## Phase 3 — Enforce one tool\nEnable enforcement only after the shadow report is safe and the approval boundary has been tested.\n\n## Phase 4 — Evidence\nPreserve Run, winningRule, ruleTrace, execution outcome, egress findings, and Replay evidence.\n\n## Exit\nMove to production only when all acceptance criteria are green and the partner approves the evidence.\n`,
        'acceptance-scorecard.md': `# Design Partner Acceptance Scorecard\n\n| Gate | Target | Result |\n|---|---|---|\n| BLOCK side effects | 0 | |\n| ASK pre-approval execution | 0 | |\n| Approved execution | exactly 1 | |\n| Cross-tenant leaks | 0 | |\n| Undetected egress secrets | 0 | |\n| Audit mismatch | 0 | |\n| Restart/Replay | PASS | |\n| First protected tool | < 10 min target | |\n\nDo not mark the pilot production-ready while any critical gate is unresolved.\n`,
        'exit-report.md': `# Design Partner Exit Report\n\n## Outcome\n- Status: pending / ready / blocked\n- Policy Pack: ${pack.id}\n- Agent: \n- Sensitive tool: \n\n## Evidence\n- Shadow report: \n- Attack report: \n- Replay run IDs: \n- Restart verification: \n\n## Before / After\n| Metric | Before | AgentGate |\n|---|---:|---:|\n| Dangerous actions reaching handler | | |\n| Pre-approval executions | | |\n| Duplicate approvals | | |\n| Audit mismatches | | |\n| Undetected egress findings | | |\n\n## Limitations\n\n`
      };
      for (const [name, content] of Object.entries(files)) await fs.writeFile(path.join(dir, name), content, 'utf8');
      console.log(`Created ${dir} for ${pack.name}`);
    }
  } else if (sub === 'check') {
    const file = process.argv[4];
    if (!file) { console.error('Usage: agentgate partner check <report.json>'); process.exitCode = 1; }
    else {
      const report = JSON.parse(await fs.readFile(path.resolve(file), 'utf8'));
      const gates = {
        blockSideEffectsZero: report.blockSideEffects === 0,
        askPreApprovalZero: report.askPreApprovalExecutions === 0,
        approvedExactlyOnce: report.approvedExecutions === 1,
        crossTenantZero: report.crossTenantLeaks === 0,
        egressUndetectedZero: report.undetectedEgressSecrets === 0,
        auditMismatchZero: report.auditMismatches === 0,
        replayAfterRestart: report.replayAfterRestart === true
      };
      const failed = Object.entries(gates).filter(([, ok]) => !ok).map(([name]) => name);
      console.log(JSON.stringify({ ready: failed.length === 0, gates, failed }, null, 2));
      process.exitCode = failed.length ? 2 : 0;
    }
  } else {
    console.error('Usage: agentgate partner <init|check> ...'); process.exitCode = 1;
  }
} else if (cmd === 'shadow') {
  const file = process.argv[3];
  if (!file) { console.error('Usage: agentgate shadow <events.json>'); process.exitCode = 1; }
  else {
    const input = JSON.parse(await fs.readFile(path.resolve(file), 'utf8'));
    const events = Array.isArray(input) ? input : (input.events || []);
    const report = analyzeShadowEvents(events);
    console.log(JSON.stringify(report, null, 2));
    if (!report.safeForEnforcement) process.exitCode = 2;
  }
} else if (cmd === 'validate-security') {
  const report = await runSecurityValidation();
  console.log(JSON.stringify(report, null, 2)); process.exitCode = report.ok ? 0 : 2;
} else if (cmd === 'scan') {
  const file = process.argv[3];
  if (!file) { console.error('Usage: agentgate scan <tools.json> [--strict]'); process.exitCode=1; }
  else { const input=JSON.parse(await fs.readFile(path.resolve(file),'utf8')); const result=scanMCPTools(Array.isArray(input)?input:(input.tools||[])); console.log(JSON.stringify(result,null,2)); if(process.argv.includes('--strict') && result.summary.high>0) process.exitCode=2; }
} else if (cmd === 'egress') {
  const file = process.argv[3];
  if (!file) { console.error('Usage: agentgate egress <response.json> [--strict]'); process.exitCode = 1; }
  else {
    const input = JSON.parse(await fs.readFile(path.resolve(file), 'utf8'));
    const result = guardEgress(input);
    console.log(JSON.stringify(result, null, 2));
    if (process.argv.includes('--strict') && result.action === 'BLOCK') process.exitCode = 2;
  }
} else if (cmd === 'attack-ci') {
  const deep = process.argv.includes('--deep');
  const gateway = createMCPGateway({ mode:'enforce', policies:{productionBlock:true, unknownActionPolicy:'block'}, tools:[{name:'export_all',handler:async()=>({})},{name:'update_production',handler:async()=>({})},{name:'delete',handler:async()=>({})},{name:'refund',handler:async()=>({})},{name:'publish',handler:async()=>({})},{name:'grant_admin',handler:async()=>({})},{name:'read_secrets',handler:async()=>({})},{name:'drop_database',handler:async()=>({})},{name:'modify_billing',handler:async()=>({})},{name:'transfer_money',handler:async()=>({})},{name:'disable_security_controls',handler:async()=>({})},{name:'purge_records',handler:async()=>({})},{name:'impersonate_user',handler:async()=>({})},{name:'remove_customer',handler:async()=>({})},{name:'export_data',handler:async()=>({})}] });
  const results = deep ? await runDeepAttackLab(gateway) : await runGatewayAttackLab(gateway);
  const summary=summarizeAttackResults(results); console.log(JSON.stringify({summary,results},null,2)); process.exitCode=summary.failed?2:0;
} else if (cmd === 'test' || cmd === 'check') {
  console.log(JSON.stringify(evaluate({ action, amount: Number(amount) }), null, 2));
} else if (cmd === 'attack') {
  const configIndex = process.argv.indexOf('--config');
  const configPath = configIndex >= 0 ? process.argv[configIndex + 1] : null;
  const deep = process.argv.includes('--deep');
  const defaultTools = [
    { name: 'export_all', handler: async () => ({ executed: true }) },
    { name: 'update_production', handler: async () => ({ executed: true }) },
    { name: 'delete', handler: async () => ({ executed: true }) },
    { name: 'refund', handler: async args => ({ refunded: args.amount }) },
    { name: 'publish', handler: async () => ({ executed: true }) },
    // Tools for the deeper, "unrecognized action name" attack set
    // (`--deep`). Harmless no-op handlers — the point is to see what the
    // POLICY decides, not to actually grant admin or drop a database.
    { name: 'grant_admin', handler: async () => ({ executed: true }) },
    { name: 'read_secrets', handler: async () => ({ executed: true }) },
    { name: 'drop_database', handler: async () => ({ executed: true }) },
    { name: 'modify_billing', handler: async () => ({ executed: true }) },
    { name: 'transfer_money', handler: async args => ({ transferred: args.amount }) },
    { name: 'disable_security_controls', handler: async () => ({ executed: true }) },
    { name: 'purge_records', handler: async () => ({ executed: true }) },
    { name: 'impersonate_user', handler: async () => ({ executed: true }) },
    { name: 'remove_customer', handler: async () => ({ executed: true }) },
    { name: 'export_data', handler: async () => ({ executed: true }) }
  ];
  let gateway = null;
  let label = 'built-in default policies';
  if (configPath) {
    const resolved = path.resolve(process.cwd(), configPath);
    try {
      const mod = await import(pathToFileURL(resolved).href);
      const gate = mod.agentgate || mod.default;
      if (!gate || typeof gate.withMCP !== 'function') {
        console.error(`No 'agentgate' export found in ${configPath} (expected the object returned by createAgentGate()). Falling back to built-in policies.`);
      } else {
        gateway = gate.withMCP({ mode: 'enforce', tools: defaultTools });
        label = `your policies (${configPath})`;
      }
    } catch (err) {
      console.error(`Could not load config ${configPath}: ${err.message}. Falling back to built-in policies.`);
    }
  }
  if (!gateway) {
    gateway = createMCPGateway({ mode: 'enforce', policies: { productionBlock: true, unknownActionPolicy: 'block' }, tools: defaultTools });
  }
  const results = deep ? await runDeepAttackLab(gateway) : await runGatewayAttackLab(gateway);
  const summary = summarizeAttackResults(results);
  console.log(`\nAgentGate Attack Runner${deep ? ' (deep: unrecognized-action-name scenarios)' : ''} — testing against ${label}`);
  console.table(results.map(x => ({ test: x.name, decision: x.decision, risk: x.risk, passed: x.passed, runId: x.runId })));
  console.log('Summary:', JSON.stringify(summary));
  if (deep && summary.allowed > 0) {
    console.error(`\n${summary.allowed} unrecognized action(s) ALLOWed through untouched. If that's not intended, set policies.unknownActionPolicy: 'ask' or 'block'.`);
  }
  process.exitCode = summary.failed ? 2 : 0;
} else if (cmd === 'report') {
  const gateway = createMCPGateway({
    mode: 'enforce',
    policies: { productionBlock: true },
    tools: [
      { name: 'export_all', handler: async () => ({ executed: true }) },
      { name: 'update_production', handler: async () => ({ executed: true }) },
      { name: 'delete', handler: async () => ({ executed: true }) },
      { name: 'refund', handler: async args => ({ refunded: args.amount }) },
      { name: 'publish', handler: async () => ({ executed: true }) }
    ]
  });
  const attacks = await runGatewayAttackLab(gateway);
  const report = generateSecurityReport({ attackResults: attacks, runs: gateway.runs(), policies: { productionBlock: true }, metadata: { agent: 'Attack Runner', environment: 'production' } });
  const jsonPath = path.resolve(process.cwd(), 'agentgate-security-report.json');
  const htmlPath = path.resolve(process.cwd(), 'agentgate-security-report.html');
  await fs.writeFile(jsonPath, JSON.stringify(report, null, 2), 'utf8');
  await fs.writeFile(htmlPath, renderSecurityReportHTML(report), 'utf8');
  console.log(`Security report: ${report.summary.status}`);
  console.log(`JSON: ${jsonPath}`);
  console.log(`HTML: ${htmlPath}`);
  process.exitCode = report.summary.failed ? 2 : 0;
} else if (cmd === 'policy') {
  const sub = process.argv[3] || 'list';
  const name = process.argv[4] || 'default';
  const registry = createPolicyRegistry({ filePath: path.resolve(process.cwd(), '.agentgate/policies.json') });
  if (sub === 'create') {
    const policy = JSON.parse(process.argv[5] || '{}');
    console.log(JSON.stringify(registry.create(name, policy), null, 2));
  } else if (sub === 'list') {
    console.log(JSON.stringify(registry.list(name), null, 2));
  } else if (sub === 'diff') {
    console.log(JSON.stringify(registry.diff(name, Number(process.argv[5]), Number(process.argv[6])), null, 2));
  } else if (sub === 'test') {
    const version = Number(process.argv[5]);
    const cases = JSON.parse(process.argv[6] || '[]');
    console.log(JSON.stringify(registry.test(name, version, cases), null, 2));
  } else if (sub === 'activate' || sub === 'rollback') {
    const version = Number(process.argv[5]);
    const result = sub === 'activate' ? registry.activate(name, version) : registry.rollback(name, version);
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.error('Usage: agentgate policy <create|list|test|activate|rollback|diff> <name> ...');
    process.exitCode = 1;
  }
} else if (cmd === 'tenant') {
  const sub = process.argv[3] || 'list';
  const registry = new TenantRegistry({ filePath: path.resolve(process.cwd(), '.agentgate/tenants.json'), keyPath: path.resolve(process.cwd(), '.agentgate/api-keys.json') });
  if (sub === 'create') console.log(JSON.stringify(registry.create(process.argv[4] || 'workspace'), null, 2));
  else if (sub === 'list') console.log(JSON.stringify(registry.list(), null, 2));
  else if (sub === 'key') {
    const tenantId = process.argv[4]; const scopes = (process.argv[5] || 'runs:read').split(',');
    console.log(JSON.stringify(registry.issueKey(tenantId, { scopes }), null, 2));
  } else if (sub === 'revoke') console.log(JSON.stringify(registry.revoke(process.argv[4]), null, 2));
  else if (sub === 'rotate') console.log(JSON.stringify(registry.rotate(process.argv[4]), null, 2));
  else { console.error('Usage: agentgate tenant <create|list|key|revoke|rotate> ...'); process.exitCode = 1; }
} else if (cmd === 'init') {
  const packIndex = process.argv.indexOf('--pack');
  const packId = packIndex >= 0 ? process.argv[packIndex + 1] : null;
  const pack = packId ? getPolicyPack(packId) : null;
  if (packId && !pack) { console.error(`Unknown policy pack: ${packId}`); process.exitCode = 1; }
  else {
    const file = path.resolve(process.cwd(), 'agentgate.config.mjs');
    const content = pack
      ? `import { createAgentGate, getPolicyPack } from 'agentgate-runtime-control';\n\nconst pack = getPolicyPack('${pack.id}');\n\nexport const agentgate = createAgentGate({\n  agent: 'SupportAgent',\n  mode: 'observe',\n  policies: {\n    ...pack.policies,\n    // Any action name AgentGate doesn't recognize (a typo, a new tool, a\n    // third-party integration using its own action names) is asked about\n    // by default here, rather than silently allowed through. Set to\n    // 'block' once you've classified every legitimate action name.\n    unknownActionPolicy: 'ask'\n  }\n});\n\nexport { pack };\n`
      : `import { createAgentGate } from 'agentgate-runtime-control';\n\nexport const agentgate = createAgentGate({\n  agent: 'MyAgent',\n  mode: 'enforce',\n  policies: {\n    productionBlock: true,\n    autoApproveAmount: 500,\n    approvalAmount: 5000,\n    // Any action name AgentGate doesn't recognize (a typo, a new tool, a\n    // third-party integration using its own action names) is asked about\n    // by default here, rather than silently allowed through. Set to\n    // 'block' once you've classified every legitimate action name, or back\n    // to 'allow' only if you understand and accept that gap.\n    unknownActionPolicy: 'ask'\n  }\n});\n`;
    try { await fs.access(file); console.error('agentgate.config.mjs already exists'); process.exitCode = 1; }
    catch {
      await fs.writeFile(file, content, 'utf8');
      console.log(`Created ${file}${pack ? ` from ${pack.name} (enforce mode)` : ''}`);
      console.log('\nNext: run `agentgate doctor` to check this config, then see examples/protect-first-tool.mjs to protect your first tool.');
    }
  }
} else if (cmd === 'approval') {
  const sub = process.argv[3];
  const urlIndex = process.argv.indexOf('--url');
  const baseUrl = (urlIndex >= 0 ? process.argv[urlIndex + 1] : (process.env.AGENTGATE_URL || 'http://localhost:8787')).replace(/\/$/, '');
  const keyIndex = process.argv.indexOf('--key');
  const apiKey = keyIndex >= 0 ? process.argv[keyIndex + 1] : (process.env.AGENTGATE_API_KEY || null);

  async function authHeaders() {
    if (apiKey) return { 'x-agentgate-key': apiKey, 'content-type': 'application/json' };
    // No API key given — try to pick up the local session cookie that `agentgate dev`
    // hands out on GET '/', so this CLI can talk to a locally running dev server
    // without any extra setup.
    try {
      const res = await fetch(`${baseUrl}/`);
      const cookie = res.headers.get('set-cookie');
      const match = cookie && cookie.match(/agentgate_local_session=[^;]+/);
      if (match) return { cookie: match[0], 'content-type': 'application/json' };
    } catch {}
    return { 'content-type': 'application/json' };
  }

  async function call(apiPath, method = 'GET', body) {
    let headers;
    try { headers = await authHeaders(); }
    catch (err) { return { status: 0, json: { error: `Could not reach ${baseUrl}: ${err.message}` } }; }
    try {
      const res = await fetch(`${baseUrl}${apiPath}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
      let json;
      try { json = await res.json(); } catch { json = { error: `Non-JSON response (status ${res.status})` }; }
      return { status: res.status, json };
    } catch (err) {
      return { status: 0, json: { error: `Could not reach ${baseUrl}: ${err.message}` } };
    }
  }

  const unreachable = (result) => {
    console.error(`Could not reach AgentGate at ${baseUrl}${result.status ? ` (HTTP ${result.status})` : ''}: ${result.json.error || 'unknown error'}`);
    console.error('Is `agentgate dev` running? Point at it with --url <http://host:port>, or pass --key <apiKey> if auth is required.');
    process.exitCode = 1;
  };

  if (sub === 'list') {
    const statusIndex = process.argv.indexOf('--status');
    const status = statusIndex >= 0 ? process.argv[statusIndex + 1] : undefined;
    const result = await call(`/api/approvals${status ? `?status=${encodeURIComponent(status)}` : ''}`);
    if (result.status !== 200) unreachable(result);
    else {
      const approvals = result.json.approvals || [];
      if (!approvals.length) console.log('No approvals found.');
      else console.table(approvals.map(a => ({ id: a.id, status: a.status, action: a.metadata?.action || a.request?.action || '', createdAt: a.createdAt, expiresAt: a.expiresAt || 'never' })));
    }
  } else if (sub === 'approve' || sub === 'deny') {
    const id = process.argv[4];
    if (!id) { console.error(`Usage: agentgate approval ${sub} <approvalId>${sub === 'deny' ? ' [reason]' : ''} [--url <url>] [--key <apiKey>]`); process.exitCode = 1; }
    else {
      const reason = sub === 'deny' ? process.argv[5] : undefined;
      const apiPath = sub === 'approve' ? '/api/approvals/approve' : '/api/approvals/deny';
      const result = await call(apiPath, 'POST', sub === 'approve' ? { approvalId: id } : { approvalId: id, reason });
      if (result.status !== 200 || result.json.ok === false) {
        if (result.status === 0 || result.status === 401 || result.status === 403) unreachable(result);
        else { console.error(`Could not ${sub} ${id}: ${result.json.error || `HTTP ${result.status}`}`); process.exitCode = 1; }
      } else {
        console.log(JSON.stringify(result.json, null, 2));
      }
    }
  } else {
    console.error(`Usage: agentgate approval <list|approve|deny> ...
  agentgate approval list [--status pending|approved|denied|expired] [--url <url>] [--key <apiKey>]
  agentgate approval approve <approvalId> [--url <url>] [--key <apiKey>]
  agentgate approval deny <approvalId> [reason] [--url <url>] [--key <apiKey>]

By default this talks to a locally running \`agentgate dev\` server at http://localhost:8787.`);
    process.exitCode = 1;
  }
} else if (cmd === 'dev') {
  const htmlPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../standalone.html');
  const html = await fs.readFile(htmlPath, 'utf8');
  const gate = createAgentGate({ agent: 'DemoAgent', mode: 'enforce', policies: { productionBlock: true } });
  const gateway = gate.withMCP({ tools: [
    { name: 'read', handler: async args => ({ ok: true, data: args, simulated: true, environment: 'demo' }) },
    { name: 'refund', handler: async args => ({ refunded: args.amount, simulated: true, environment: 'demo' }) },
    { name: 'delete', handler: async args => ({ deleted: args.id, simulated: true, environment: 'demo' }) },
    { name: 'export_all', handler: async args => ({ simulated: true, environment: 'demo', action: 'export_all', args }) },
    { name: 'update_production', handler: async args => ({ simulated: true, environment: 'demo', action: 'update_production', args }) },
    { name: 'publish', handler: async args => ({ simulated: true, environment: 'demo', action: 'publish', args }) }
  ]});
  await gateway.handle({ jsonrpc:'2.0', id:1, method:'tools/call', params:{ name:'read', arguments:{ id:'demo_customer' }, agent:'DemoAgent', action:'read', environment:'development' }});
  await gateway.handle({ jsonrpc:'2.0', id:2, method:'tools/call', params:{ name:'refund', arguments:{ amount:1200, customerId:'demo_customer' }, agent:'DemoAgent', action:'refund', environment:'development' }});
  await gateway.handle({ jsonrpc:'2.0', id:3, method:'tools/call', params:{ name:'delete', arguments:{ id:'demo_customer' }, agent:'DemoAgent', action:'delete', environment:'production' }});
  const portArgIndex = process.argv.indexOf('--port');
  const port = Number(portArgIndex >= 0 ? process.argv[portArgIndex + 1] : process.env.PORT || 8787);
  if (!Number.isInteger(port) || port < 1 || port > 65535) { console.error('Invalid port. Use --port <1-65535> or PORT=<port>.'); process.exitCode = 1; }
  else {
    const { server } = createControlPlane({ gateway, html, localDevSession: true });
    server.on('error', error => {
      if (error?.code === 'EADDRINUSE') console.error(`Port ${port} is already in use. Use agentgate dev --port <port> or PORT=<port>.`);
      else console.error(`AgentGate dev server error: ${error?.message || error}`);
      process.exitCode = 1;
    });
    server.listen(port, () => console.log(`AgentGate Control Plane: http://localhost:${port}`));
  }
} else {
  showHelp();
}
