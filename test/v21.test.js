import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { createMCPGateway } from '../src/mcp-gateway.js';
import { SlidingWindowLimiter } from '../src/telemetry.js';
import { decodeJWT, verifyOIDCJWT } from '../src/oidc.js';
import { createControlPlane } from '../src/control-plane.js';

function jwtHS(payload, secret='test-secret') {
  const h = Buffer.from(JSON.stringify({alg:'HS256',typ:'JWT'})).toString('base64url');
  const p = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const input = `${h}.${p}`;
  const sig = crypto.createHmac('sha256', secret).update(input).digest('base64url');
  return `${input}.${sig}`;
}

test('v2.1 telemetry records decisions and execution latency', async () => {
  const gateway = createMCPGateway({ tools: [{ name:'read', handler: async () => ({ok:true}) }] });
  await gateway.handle({jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'read',arguments:{}}});
  const metrics = gateway.telemetry.snapshot();
  assert.equal(metrics.counters['runs.recorded'], 1);
  assert.equal(metrics.counters['decisions.allow'], 1);
  assert.equal(metrics.counters['tools.executed'], 1);
  assert.equal(metrics.latency['tool.execution'].count, 1);
});

test('v2.1 event stream receives runtime events', async () => {
  const gateway = createMCPGateway({ tools: [{ name:'read', handler: async () => 'ok' }] });
  const events=[]; const off=gateway.events.subscribe('*', e=>events.push(e.event));
  await gateway.handle({jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'read',arguments:{}}});
  off();
  assert.ok(events.includes('run.recorded'));
});

test('v2.1 sliding window limiter fails closed at the configured limit', () => {
  const limiter = new SlidingWindowLimiter({limit:2,windowMs:1000});
  assert.equal(limiter.check('x').allowed,true);
  assert.equal(limiter.check('x').allowed,true);
  assert.equal(limiter.check('x').allowed,false);
});

test('v2.1 verifies OIDC HS256 JWT claims and rejects tampering', () => {
  const token = jwtHS({sub:'u1',tenant_id:'ten_1',iss:'https://issuer',aud:'agentgate',exp:Math.floor(Date.now()/1000)+60});
  const payload = verifyOIDCJWT(token,{secret:'test-secret',issuer:'https://issuer',audience:'agentgate'});
  assert.equal(payload.sub,'u1');
  const tampered = `${token.split('.').slice(0,2).join('.')}.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA`;
  assert.throws(() => verifyOIDCJWT(tampered,{secret:'test-secret'}), /signature verification failed/);
  assert.equal(decodeJWT(token).header.alg,'HS256');
});

test('v2.1 control plane exposes readiness and metrics', async () => {
  const gateway=createMCPGateway();
  const {server,api}=createControlPlane({gateway});
  assert.equal((await api('/api/ready')).ready,true);
  assert.equal(typeof (await api('/api/metrics')).uptimeSeconds,'number');
  server.close();
});
