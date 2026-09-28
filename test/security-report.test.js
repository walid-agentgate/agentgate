import test from 'node:test';
import assert from 'node:assert/strict';
import { generateSecurityReport, renderSecurityReportHTML } from '../src/security-report.js';

test('security report aggregates attack results and runs', () => {
  const report = generateSecurityReport({
    attackResults: [
      { id:'a', name:'Delete', decision:'BLOCK', risk:90, passed:true, runId:'r1' },
      { id:'b', name:'Refund', decision:'ALLOW', risk:20, passed:false, runId:'r2' }
    ],
    runs: [{ id:'r1', createdAt:'now', decision:'BLOCK', risk:90, reason:'blocked', request:{action:'delete'} }],
    policies: { productionBlock:true },
    metadata: { agent:'Demo', environment:'production' }
  });
  assert.equal(report.schemaVersion, '1.0');
  assert.equal(report.summary.total, 2);
  assert.equal(report.summary.passed, 1);
  assert.equal(report.summary.failed, 1);
  assert.equal(report.summary.findingCount, 1);
  assert.equal(report.summary.runCount, 1);
  assert.equal(report.findings[0].name, 'Refund');
  assert.equal(report.topRisks[0].risk, 90);
  assert.ok(report.behavior);
  assert.ok(report.blastRadius);
});

test('security report renders standalone HTML', () => {
  const html = renderSecurityReportHTML(generateSecurityReport({ attackResults: [] }));
  assert.match(html, /AGENTGATE \/ SECURITY REPORT/);
  assert.match(html, /No attack results/);
  assert.match(html, /Behavior analysis/);
  assert.match(html, /Blast radius/);
});
