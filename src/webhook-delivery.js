import crypto from 'node:crypto';
import dns from 'node:dns/promises';
import net from 'node:net';

export function signWebhook(secret, body) {
  return `sha256=${crypto.createHmac('sha256', secret).update(body).digest('hex')}`;
}

const BLOCKED_IPV4 = [
  [/^127\./, 'loopback'], [/^10\./, 'private'], [/^192\.168\./, 'private'],
  [/^169\.254\./, 'link-local'], [/^0\./, 'unspecified'], [/^224\./, 'multicast'],
  [/^172\.(1[6-9]|2\d|3[0-1])\./, 'private']
];
const BLOCKED_IPV6 = [/^::1$/, /^fc/i, /^fd/i, /^fe80:/i, /^ff/i, /^::$/];

export function isBlockedAddress(address) {
  if (net.isIPv4(address)) return BLOCKED_IPV4.find(([re]) => re.test(address))?.[1] || null;
  if (net.isIPv6(address)) return BLOCKED_IPV6.find(re => re.test(address)) ? 'private-or-special' : null;
  return null;
}

export async function validateWebhookTarget(rawUrl, options = {}) {
  let parsed;
  try { parsed = new URL(String(rawUrl)); } catch { throw new Error('Webhook URL is invalid'); }
  if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('Webhook URL must use http or https');
  if (parsed.username || parsed.password) throw new Error('Webhook URL credentials are not allowed');
  if (options.allowPrivateNetworks === true) return parsed;
  const host = parsed.hostname.replace(/^\[|\]$/g, '');
  const literalReason = isBlockedAddress(host);
  if (literalReason) throw new Error(`Webhook target blocked: ${literalReason}`);
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host === 'metadata.google.internal') {
    throw new Error('Webhook target blocked: local or metadata hostname');
  }
  const lookup = options.lookup || dns.lookup;
  const addresses = await lookup(host, { all: true, verbatim: true });
  if (!addresses.length) throw new Error('Webhook hostname did not resolve');
  for (const entry of addresses) {
    const reason = isBlockedAddress(entry.address);
    if (reason) throw new Error(`Webhook target blocked: ${reason}`);
  }
  return parsed;
}

export function createWebhookDispatcher(options = {}) {
  const fetchImpl = options.fetch || globalThis.fetch;
  if (typeof fetchImpl !== 'function') throw new Error('Webhook delivery requires fetch');
  const maxAttempts = Math.max(1, Number(options.maxAttempts || 3));
  const timeoutMs = Math.max(250, Number(options.timeoutMs || 8000));
  const lookup = options.lookup || dns.lookup;
  return async function deliver(webhook, delivery) {
    await validateWebhookTarget(webhook.url, { ...options, lookup });
    const body = JSON.stringify({ id: delivery.id, event: delivery.event, tenantId: delivery.tenantId, payload: delivery.payload, createdAt: delivery.createdAt });
    let lastError = null;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const response = await fetchImpl(webhook.url, {
          method: 'POST', redirect: 'error',
          headers: { 'content-type': 'application/json', 'user-agent': 'AgentGate-Webhook/2.4', 'x-agentgate-event': delivery.event, 'x-agentgate-signature': signWebhook(webhook.secret, body) },
          body, signal: controller.signal
        });
        clearTimeout(timer);
        if (response.ok) return { status: 'delivered', attempts: attempt, statusCode: response.status };
        lastError = new Error(`Webhook returned HTTP ${response.status}`);
      } catch (error) { clearTimeout(timer); lastError = error; }
    }
    return { status: 'failed', attempts: maxAttempts, error: lastError?.message || 'Webhook delivery failed' };
  };
}
