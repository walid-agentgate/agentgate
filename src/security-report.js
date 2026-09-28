import { summarizeAttackResults } from './attack-lab.js';
import { analyzeBehavior, analyzeBlastRadius } from './behavior.js';

function safe(value) { return String(value ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch])); }

export function generateSecurityReport({ attackResults = [], runs = [], policies = {}, metadata = {}, behavior, blastRadius } = {}) {
  const summary = summarizeAttackResults(attackResults);
  const findings = attackResults
    .filter(item => !item.passed)
    .map(item => ({ id: item.id, name: item.name, decision: item.decision, risk: Number(item.risk || 0), runId: item.runId || null }));
  const topRisks = [...attackResults].sort((a,b) => Number(b.risk||0) - Number(a.risk||0)).slice(0,5).map(item => ({
    id:item.id, name:item.name, risk:Number(item.risk||0), decision:item.decision, passed:Boolean(item.passed), runId:item.runId||null
  }));
  const behaviorAnalysis = behavior || analyzeBehavior(runs);
  const blastRadiusAnalysis = blastRadius || analyzeBlastRadius(runs);
  const generatedAt = new Date().toISOString();
  return {
    schemaVersion: '1.0',
    product: 'AgentGate',
    reportType: 'security-assessment',
    generatedAt,
    metadata: { environment: metadata.environment || 'production', agent: metadata.agent || 'unknown', ...metadata },
    summary: { ...summary, findingCount: findings.length, runCount: runs.length },
    findings,
    topRisks,
    policies,
    behavior: behaviorAnalysis,
    blastRadius: blastRadiusAnalysis,
    attacks: attackResults.map(({ response, ...item }) => ({ ...item })),
    runs: runs.map(run => ({ id: run.id, createdAt: run.createdAt, decision: run.decision, risk: run.risk, reason: run.reason, request: run.request }))
  };
}

export function renderSecurityReportHTML(report) {
  const s = report.summary;
  const rows = report.attacks.map(item => `<tr><td>${safe(item.name)}</td><td>${safe(item.decision)}</td><td>${safe(item.risk)}</td><td>${item.passed ? 'PASS' : 'FINDING'}</td></tr>`).join('');
  const status = safe(s.status);
  const behavior = report.behavior || { status:'NORMAL', findingCount:0, maxRisk:0, findings:[] };
  const blast = report.blastRadius || { status:'LOW', maxScore:0, assessments:[] };
  const behaviorRows = behavior.findings.map(item => `<tr><td>${safe(item.title)}</td><td>${safe(item.severity)}</td><td>${safe(item.risk)}</td><td><code>${safe(item.action)}</code></td></tr>`).join('');
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>AgentGate Security Report</title><style>body{margin:0;background:#08080d;color:#eee;font:15px system-ui,sans-serif}main{max-width:1000px;margin:auto;padding:40px}.hero,.card{background:#11111a;border:1px solid #29283a;border-radius:18px;padding:24px;margin-bottom:18px}.brand{color:#a78bfa;font-weight:800;letter-spacing:.08em}.status{font-size:28px;font-weight:800;margin:12px 0}.grid{display:grid;grid-template-columns:repeat(4,1fr);gap:12px}.metric{background:#0b0b12;border-radius:12px;padding:16px}.metric b{display:block;font-size:24px}.muted{color:#9292a4}table{width:100%;border-collapse:collapse}th,td{text-align:left;padding:12px;border-bottom:1px solid #262533}th{color:#aaa}code{color:#c4b5fd}.pill{display:inline-block;padding:6px 10px;border:1px solid #343246;border-radius:999px;margin-right:8px}@media(max-width:700px){main{padding:18px}.grid{grid-template-columns:repeat(2,1fr)}}</style></head><body><main><section class="hero"><div class="brand">AGENTGATE / SECURITY REPORT</div><div class="status">${status}</div><div class="muted">${safe(report.metadata.agent)} · ${safe(report.metadata.environment)} · ${safe(report.generatedAt)}</div></section><section class="card"><div class="grid"><div class="metric"><span class="muted">Attacks</span><b>${s.total}</b></div><div class="metric"><span class="muted">Passed</span><b>${s.passed}</b></div><div class="metric"><span class="muted">Findings</span><b>${s.failed}</b></div><div class="metric"><span class="muted">Avg risk</span><b>${s.averageRisk}</b></div></div></section><section class="card"><h2>Behavior analysis</h2><p><span class="pill">Status: ${safe(behavior.status)}</span><span class="pill">Findings: ${behavior.findingCount}</span><span class="pill">Max risk: ${behavior.maxRisk}</span></p><table><thead><tr><th>Finding</th><th>Severity</th><th>Risk</th><th>Action</th></tr></thead><tbody>${behaviorRows || '<tr><td colspan="4">No behavior findings</td></tr>'}</tbody></table></section><section class="card"><h2>Blast radius</h2><p><span class="pill">Status: ${safe(blast.status)}</span><span class="pill">Max score: ${blast.maxScore}</span><span class="pill">Runs: ${blast.runCount}</span></p><p class="muted">Deterministic estimate based on request metadata, not a guarantee of actual impact.</p></section><section class="card"><h2>Attack assessment</h2><table><thead><tr><th>Test</th><th>Decision</th><th>Risk</th><th>Result</th></tr></thead><tbody>${rows || '<tr><td colspan="4">No attack results</td></tr>'}</tbody></table></section><section class="card"><h2>Policies</h2><pre><code>${safe(JSON.stringify(report.policies,null,2))}</code></pre></section></main></body></html>`;
}
