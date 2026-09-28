import crypto from 'node:crypto';

const HIGH_RISK_NAMES = new Set(['delete','remove','drop','refund','publish','deploy','execute','run_command','shell','write_file','export_all','update_production']);
const SENSITIVE_WORDS = /password|secret|token|api[_-]?key|private[_-]?key|credential|cookie/i;

function stable(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${stable(value[k])}`).join(',')}}`;
}
export function fingerprintTool(tool = {}) {
  const contract = { name: tool.name, description: tool.description || '', inputSchema: tool.inputSchema || { type:'object' }, annotations: tool.annotations || {} };
  return crypto.createHash('sha256').update(stable(contract)).digest('hex');
}
export function scanMCPTools(tools = []) {
  const findings = [];
  const normalized = tools.map(t => ({ ...t, fingerprint: fingerprintTool(t) }));
  for (const tool of normalized) {
    const name = String(tool.name || '').toLowerCase();
    const description = String(tool.description || '');
    if (HIGH_RISK_NAMES.has(name) || /\b(delete|refund|deploy|publish|execute|shell|command)\b/i.test(name)) {
      findings.push({ severity:'high', code:'dangerous-tool', tool:tool.name, message:'Tool exposes a potentially destructive or privileged capability.' });
    }
    if (/ignore (previous|all)|system prompt|do not follow|bypass|override (policy|security)/i.test(description)) {
      findings.push({ severity:'high', code:'description-injection', tool:tool.name, message:'Tool description contains instruction-like text that may influence an agent.' });
    }
    if (SENSITIVE_WORDS.test(stable(tool.inputSchema))) {
      findings.push({ severity:'medium', code:'sensitive-input', tool:tool.name, message:'Tool schema contains a field that appears to accept sensitive credentials or secrets.' });
    }
    if (!tool.inputSchema || tool.inputSchema.type !== 'object') {
      findings.push({ severity:'medium', code:'weak-schema', tool:tool.name, message:'Tool input schema is missing or is not an object schema.' });
    }
  }
  const high = findings.filter(f=>f.severity==='high').length;
  const medium = findings.filter(f=>f.severity==='medium').length;
  return { tools: normalized, findings, summary:{tools:normalized.length, high, medium, low:0, status:high?'REVIEW_REQUIRED':medium?'REVIEW':'PASS'} };
}
export function createToolTrustStore(initial = {}) {
  const pins = new Map(Object.entries(initial));
  return {
    pin(tools=[]) { const out={}; for(const tool of tools){ const fp=fingerprintTool(tool); pins.set(tool.name,fp); out[tool.name]=fp; } return out; },
    check(tools=[]) { const changes=[]; for(const tool of tools){ const current=fingerprintTool(tool); const previous=pins.get(tool.name); if(previous && previous!==current) changes.push({tool:tool.name,previous,current,severity:'high'}); } return {ok:changes.length===0,changes}; },
    snapshot(){ return Object.fromEntries(pins); }
  };
}
