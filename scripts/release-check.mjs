import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const root = process.cwd();
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const failures = [];
const ok = (name, condition, detail = '') => condition ? console.log(`PASS ${name}${detail ? ` — ${detail}` : ''}`) : failures.push(`${name}${detail ? ` — ${detail}` : ''}`);

// Any valid semver, not a hardcoded major.minor series — pinning this to
// e.g. /^2\.13\.\d+$/ makes release-check fail on every future release
// (as it did going from 2.13.x to 2.14.x) for a reason that has nothing to
// do with whether the release is actually clean.
ok('package version', /^\d+\.\d+\.\d+$/.test(pkg.version), pkg.version);
// A stale version string in README.md/standalone.html confused two separate
// independent trial reviews (2.14.2 and this one): a reader sees "v2.13.8"
// or "v2.14.1" in prose and assumes they installed the wrong version, even
// though package.json and `agentgate --version` were always correct. Catch
// it at release time instead of relying on someone to notice by eye.
ok('README version matches package.json', fs.readFileSync(path.join(root, 'README.md'), 'utf8').includes(`v${pkg.version}`), `expected "v${pkg.version}" somewhere in README.md`);
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
// docs/assurance/ accumulates one versioned snapshot folder per release (by
// design, see docs/assurance/*/RELEASE-DECISION.md) and is meant to stay in
// the git history as an evidence trail, not ship to every npm consumer —
// an independent review flagged this as unnecessary package bloat/noise.
ok('npm pack excludes historical assurance docs', !files.some(f => f.startsWith('docs/assurance/')));

if (failures.length) {
  console.error(`FAIL release-check (${failures.length})`);
  for (const f of failures) console.error(`- ${f}`);
  process.exit(1);
}
console.log('PASS release-check');
