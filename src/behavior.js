const SENSITIVE_READS = new Set(['read', 'search', 'list', 'get', 'fetch', 'export']);
const DESTRUCTIVE = new Set(['delete', 'refund', 'publish', 'deploy', 'export_all', 'update_production']);
const PRIVILEGED = new Set(['update_production', 'deploy', 'delete', 'export_all', 'publish']);
const DATA_EXFIL = new Set(['export_all', 'export', 'download_all', 'bulk_export']);

function actionOf(run) {
  return String(run?.request?.action || run?.request?.tool || '').toLowerCase();
}
function agentOf(run) { return String(run?.request?.agent || 'unknown'); }
function envOf(run) { return String(run?.request?.environment || run?.request?.context?.environment || 'production'); }
function amountOf(run) { return Number(run?.request?.amount ?? run?.request?.input?.amount ?? 0) || 0; }
function contextOf(run) { return run?.request?.context || {}; }
function unique(items) { return [...new Set(items.filter(Boolean))]; }

export function analyzeBehavior(runs = [], options = {}) {
  const windowSize = Math.max(2, Number(options.windowSize || 8));
  const ordered = [...runs].sort((a, b) => new Date(a?.createdAt || 0) - new Date(b?.createdAt || 0));
  const findings = [];

  for (let i = 0; i < ordered.length; i++) {
    const run = ordered[i];
    const action = actionOf(run);
    const recent = ordered.slice(Math.max(0, i - windowSize + 1), i + 1);
    const recentActions = recent.map(actionOf);
    const decision = String(run?.decision || '').toUpperCase();

    if (decision === 'BLOCK' || decision === 'ASK') {
      const priorSensitive = recent.slice(0, -1).some(item => SENSITIVE_READS.has(actionOf(item)));
      if (priorSensitive && (DESTRUCTIVE.has(action) || DATA_EXFIL.has(action))) {
        findings.push(finding('behavior.tool-chain-risk', 'Suspicious tool chain', 'A sensitive read was followed by a high-impact action in the same activity window.', 82, run, {
          sequence: recentActions.slice(-4), indicators: ['sensitive-read-before-high-impact-action']
        }));
      }
    }

    if (PRIVILEGED.has(action) && envOf(run) === 'production') {
      const agent = agentOf(run);
      const priorDenied = recent.slice(0, -1).filter(item => agentOf(item) === agent && ['BLOCK', 'ASK'].includes(String(item?.decision || '').toUpperCase()));
      if (priorDenied.length >= 2) {
        findings.push(finding('behavior.escalation-pattern', 'Repeated escalation attempt', 'The same agent attempted multiple controlled actions before a privileged production action.', 88, run, {
          priorControlledRuns: priorDenied.map(item => item.id).filter(Boolean)
        }));
      }
    }

    if (DATA_EXFIL.has(action)) {
      const broadScope = Boolean(contextOf(run).scope === 'all' || contextOf(run).dataScope === 'all' || run?.request?.scope === 'all');
      if (broadScope || amountOf(run) > 1000) {
        findings.push(finding('behavior.data-exfiltration', 'Broad data access attempt', 'The action requests an unusually broad export scope or volume.', 94, run, {
          scope: contextOf(run).scope || contextOf(run).dataScope || run?.request?.scope || null,
          amount: amountOf(run)
        }));
      }
    }

    if (action === 'refund' && amountOf(run) > Number(options.highValueRefund || 5000)) {
      findings.push(finding('behavior.high-value-side-effect', 'High-value side effect', 'A refund exceeds the configured high-value threshold.', 90, run, { amount: amountOf(run) }));
    }
  }

  const repeated = detectRepeatedAttempts(ordered, windowSize);
  findings.push(...repeated);
  return summarizeBehavior(findings, ordered);
}

function detectRepeatedAttempts(runs, windowSize) {
  const findings = [];
  const byAgent = new Map();
  for (const run of runs) {
    const key = agentOf(run);
    if (!byAgent.has(key)) byAgent.set(key, []);
    byAgent.get(key).push(run);
  }
  for (const [agent, items] of byAgent) {
    for (let i = 0; i < items.length; i++) {
      const slice = items.slice(Math.max(0, i - windowSize + 1), i + 1);
      const controlled = slice.filter(item => ['BLOCK', 'ASK'].includes(String(item?.decision || '').toUpperCase()));
      if (controlled.length >= 3) {
        const latest = items[i];
        findings.push(finding('behavior.repeated-control', 'Repeated controlled actions', 'The agent generated multiple blocked or approval-required actions within a short activity window.', 78, latest, {
          agent, controlledCount: controlled.length, runIds: controlled.map(item => item.id).filter(Boolean)
        }));
        break;
      }
    }
  }
  return findings;
}

function finding(id, title, description, risk, run, evidence = {}) {
  return { id, title, description, risk, severity: risk >= 90 ? 'critical' : risk >= 80 ? 'high' : risk >= 60 ? 'medium' : 'low', runId: run?.id || null, action: actionOf(run), agent: agentOf(run), environment: envOf(run), evidence };
}

export function summarizeBehavior(findings = [], runs = []) {
  const maxRisk = findings.reduce((m, item) => Math.max(m, Number(item.risk || 0)), 0);
  const status = maxRisk >= 90 ? 'HIGH_RISK' : maxRisk >= 70 ? 'ELEVATED' : 'NORMAL';
  return {
    status,
    findingCount: findings.length,
    critical: findings.filter(x => x.severity === 'critical').length,
    high: findings.filter(x => x.severity === 'high').length,
    medium: findings.filter(x => x.severity === 'medium').length,
    low: findings.filter(x => x.severity === 'low').length,
    maxRisk,
    runsAnalyzed: runs.length,
    agents: unique(runs.map(agentOf)),
    findings
  };
}

export function calculateBlastRadius(run = {}, options = {}) {
  const action = actionOf(run);
  const context = contextOf(run);
  const input = run?.request || {};
  const targets = Number(context.targetCount ?? input.targetCount ?? 1) || 1;
  const scope = String(context.scope ?? context.dataScope ?? input.scope ?? 'single').toLowerCase();
  const environment = envOf(run);
  const privileged = PRIVILEGED.has(action);
  const destructive = DESTRUCTIVE.has(action);
  const exportAction = DATA_EXFIL.has(action);

  let score = 10;
  const factors = [];
  if (targets > 1) { score += Math.min(25, targets * 2); factors.push(`targets:${targets}`); }
  if (scope === 'all' || scope === 'global' || scope === 'organization') { score += 25; factors.push(`scope:${scope}`); }
  if (environment === 'production') { score += 20; factors.push('production'); }
  if (privileged) { score += 15; factors.push('privileged-action'); }
  if (destructive) { score += 10; factors.push('destructive-action'); }
  if (exportAction) { score += 15; factors.push('data-export'); }
  if (amountOf(run) > 5000) { score += 10; factors.push('high-value'); }
  score = Math.min(100, score);

  const level = score >= 80 ? 'critical' : score >= 60 ? 'high' : score >= 35 ? 'medium' : 'low';
  return { score, level, action, environment, estimatedTargets: targets, scope, factors, note: 'Blast radius is a deterministic risk estimate based on request metadata; it is not a guarantee of actual impact.' };
}

export function analyzeBlastRadius(runs = []) {
  const assessments = runs.map(run => ({ runId: run.id || null, ...calculateBlastRadius(run) }));
  const maxScore = assessments.reduce((m, x) => Math.max(m, x.score), 0);
  return {
    status: maxScore >= 80 ? 'CRITICAL' : maxScore >= 60 ? 'HIGH' : maxScore >= 35 ? 'MEDIUM' : 'LOW',
    maxScore,
    runCount: assessments.length,
    assessments
  };
}
