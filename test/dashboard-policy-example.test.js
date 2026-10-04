import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { evaluate } from '../src/policy-engine.js';

// Regression test for a real bug a colleague's dashboard trial found: the
// "New policy" modal in standalone.html pre-fills an example policy object,
// and the "Test policy" modal pre-fills example test cases that assume
// specific ALLOW/ASK/BLOCK outcomes for that example. These two examples
// live in different functions in a hand-edited HTML file, so nothing at
// build time keeps them in sync — it's easy to change one (e.g. switch the
// example policy's shape) without noticing the other's expectations no
// longer hold against the real policy engine. That happened once already:
// the example policy used a fictional shape ({refund:{max:5000}}) the
// engine never reads, so the pre-filled test case (amount 100 -> ALLOW)
// always failed. This test extracts both examples straight from the
// shipped HTML and checks them against each other through the real engine.

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const html = fs.readFileSync(path.join(__dirname, '..', 'standalone.html'), 'utf8');

function extractObjectLiteral(html, marker) {
  const idx = html.indexOf(marker);
  assert.ok(idx !== -1, `could not find "${marker}" in standalone.html`);
  const stringifyIdx = html.indexOf('JSON.stringify(', idx);
  assert.ok(stringifyIdx !== -1, `could not find "JSON.stringify(" after "${marker}"`);
  const start = stringifyIdx + 'JSON.stringify('.length;
  const open = html[start];
  const close = open === '{' ? '}' : open === '[' ? ']' : null;
  assert.ok(close, `expected the literal right after JSON.stringify( to start with { or [, got "${open}"`);
  let depth = 0, i = start;
  for (; i < html.length; i++) {
    if (html[i] === open) depth++;
    else if (html[i] === close) { depth--; if (depth === 0) { i++; break; } }
  }
  const literal = html.slice(start, i);
  // eslint-disable-next-line no-new-func -- trusted, local file, not user input
  return new Function(`return (${literal});`)();
}

test('dashboard "New policy" example policy and "Test policy" example cases agree with the real policy engine', () => {
  const policy = extractObjectLiteral(html, 'function showPolicyForm(){');
  const cases = extractObjectLiteral(html, 'function testPolicy(name,version){');
  assert.ok(Array.isArray(cases) && cases.length > 0, 'expected an array of example test cases');
  for (const c of cases) {
    const result = evaluate(c.input, policy);
    assert.equal(result.decision, c.expected, `case "${c.name}" (${JSON.stringify(c.input)}) against the dashboard's example policy expected ${c.expected} but got ${result.decision} (${result.reason})`);
  }
});
