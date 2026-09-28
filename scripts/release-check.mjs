import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const root = process.cwd();
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const failures = [];
const ok = (name, condition, detail = '') => condition ? console.log(`PASS ${name}${detail ? ` — ${detail}` : ''}`) : failures.push(`${name}${detail ? ` — ${detail}` : ''}`);

ok('package version', /^2\.13\.\d+$/.test(pkg.version), pkg.version);
ok('standalone exists', fs.existsSync(path.join(root, 'standalone.html')));
ok('production docs', ['production-deployment.md','production-quickstart.md','data-protection.md','incident-response.md','performance.md','performance-baseline.md','integration-matrix.md','threat-model.md','observability-alerting.md','production-readiness.md','external-security-review-test-pack.md','managed-postgres-acceptance-test.md'].every(f => fs.existsSync(path.join(root, 'docs', f))));
ok('production compose', fs.existsSync(path.join(root, 'docker-compose.production.yml')));
ok('npm lockfile', fs.existsSync(path.join(root, 'package-lock.json')));
ok('postgres RLS schema', /enable row level security/i.test(fs.readFileSync(path.join(root, 'schema/postgres.sql'), 'utf8')));
ok('postgres tenant checks', /tenant_id\s*=\s*current_setting\('agentgate\.tenant_id'/i.test(fs.readFileSync(path.join(root, 'schema/postgres.sql'), 'utf8')));
ok('external review is not falsely claimed', /Not completed/i.test(fs.readFileSync(path.join(root, 'docs/external-security-review.md'), 'utf8')));

const html = fs.readFileSync(path.join(root, 'standalone.html'), 'utf8');
const scripts = [...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/gi)].map(m => m[1]);
const tmp = path.join(root, '.release-standalone-check.mjs');
fs.writeFileSync(tmp, scripts.join('\n'));
try { new Function(scripts.join('\n')); ok('standalone JS syntax', true); }
catch (e) { ok('standalone JS syntax', false, e.message); }
finally { fs.rmSync(tmp, { force: true }); }

const pack = execFileSync('npm', ['pack','--dry-run','--json'], { encoding: 'utf8' });
const files = JSON.parse(pack)[0]?.files?.map(x => x.path) || [];
ok('npm pack has no test files', !files.some(f => f.startsWith('test/')));
ok('npm pack has no internal tarballs', !files.some(f => /\.tgz$/.test(f)));
ok('npm pack has no stale package tarballs', !files.some(f => /agentgate-runtime-control-2\.13\.[0-3]\./.test(f)));

if (failures.length) {
  console.error(`FAIL release-check (${failures.length})`);
  for (const f of failures) console.error(`- ${f}`);
  process.exit(1);
}
console.log('PASS release-check');
