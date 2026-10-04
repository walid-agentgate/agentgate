import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

// Regression test for the Monitor section's pending-approval payload
// masking, added after a colleague's full technical trial flagged that
// raw approval request payloads (customer IDs, emails, etc.) were shown
// inline in plain JSON with no redaction. This test extracts the real
// maskSensitive()/maskValue() functions straight from standalone.html (not
// a reimplementation) and checks they actually redact sensitive-looking
// keys while leaving operationally necessary fields (action, amount)
// readable, since an approver needs to see the amount to make a decision.

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const html = fs.readFileSync(path.join(__dirname, '..', 'standalone.html'), 'utf8');

function extractFunctionSource(name) {
  const marker = `function ${name}(`;
  const idx = html.indexOf(marker);
  assert.ok(idx !== -1, `could not find "${marker}" in standalone.html`);
  let depth = 0, i = html.indexOf('{', idx);
  const start = i;
  for (; i < html.length; i++) {
    if (html[i] === '{') depth++;
    else if (html[i] === '}') { depth--; if (depth === 0) { i++; break; } }
  }
  return html.slice(idx, i);
}

function extractConst(name) {
  const marker = `const ${name}=`;
  const idx = html.indexOf(marker);
  assert.ok(idx !== -1, `could not find "${marker}" in standalone.html`);
  const end = html.indexOf(';', idx);
  return html.slice(idx, end + 1);
}

function loadMaskHelpers() {
  const src = extractConst('SENSITIVE_KEY') + '\n' + extractFunctionSource('maskSensitive') + '\n' + extractFunctionSource('maskValue') + '\nmodule.exports = { maskSensitive, maskValue };';
  const sandbox = { module: { exports: {} } };
  vm.runInNewContext(src, sandbox);
  return sandbox.module.exports;
}

test('maskSensitive() redacts sensitive-looking fields but keeps operational fields readable', () => {
  const { maskSensitive } = loadMaskHelpers();
  const masked = maskSensitive({
    action: 'refund',
    tool: 'refund',
    amount: 1200,
    customerId: 'cust_abc123',
    email: 'person@example.com',
    note: 'VIP customer'
  });
  assert.equal(masked.action, 'refund', 'action must stay readable');
  assert.equal(masked.tool, 'refund', 'tool must stay readable');
  assert.equal(masked.amount, 1200, 'amount must stay readable — the approver needs it to decide');
  assert.notEqual(masked.customerId, 'cust_abc123', 'customerId must be redacted');
  assert.notEqual(masked.email, 'person@example.com', 'email must be redacted');
  assert.equal(masked.note, 'VIP customer', 'non-sensitive free text is left alone');
});

test('maskSensitive() recurses into nested objects', () => {
  const { maskSensitive } = loadMaskHelpers();
  const masked = maskSensitive({ action: 'export', payload: { email: 'a@b.com', amount: 50 } });
  assert.notEqual(masked.payload.email, 'a@b.com');
  assert.equal(masked.payload.amount, 50);
});
