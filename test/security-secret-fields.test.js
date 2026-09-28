import test from 'node:test';
import assert from 'node:assert/strict';
import { guardEgress, inspectEgress } from '../src/egress-guard.js';

test('generic sensitive fields are blocked and redacted', () => {
  const input = {
    secret: 'super-secret-value',
    password: 'correct-horse-battery-staple',
    passphrase: 'hidden phrase',
    private_key: 'PRIVATE-DATA',
    access_token: 'access-token-value',
    refresh_token: 'refresh-token-value',
    authorization: 'Bearer private-value',
    client_secret: 'client-secret-value'
  };
  const result = guardEgress(input);
  assert.equal(result.action, 'BLOCK');
  assert.equal(result.allowed, false);
  for (const key of Object.keys(input)) assert.equal(result.value[key], '[REDACTED:SECRET]');
  assert.equal(result.findings.filter(x => x.type === 'generic_secret').length, Object.keys(input).length);
  assert.doesNotMatch(JSON.stringify(result.value), /super-secret-value|correct-horse|PRIVATE-DATA|access-token-value|client-secret-value/);
});

test('generic sensitive fields are detected in inspect without leaking values', () => {
  const result = inspectEgress({ secret: 'super-secret-value', nested: { password: 'hidden' } });
  assert.equal(result.action, 'BLOCK');
  assert.ok(result.findings.filter(x => x.type === 'generic_secret').length >= 2);
  assert.doesNotMatch(JSON.stringify(result), /super-secret-value|hidden/);
});

test('generic sensitive fields work when nested in arrays', () => {
  const result = guardEgress({ items: [{ secret: 'one' }, { access_token: 'two' }] });
  assert.equal(result.action, 'BLOCK');
  assert.equal(result.value.items[0].secret, '[REDACTED:SECRET]');
  assert.equal(result.value.items[1].access_token, '[REDACTED:SECRET]');
});
