import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { TenantRegistry } from '../src/multi-tenant.js';
import { createControlPlane } from '../src/control-plane.js';
import { verifyOIDCJWT } from '../src/oidc.js';
import { POSTGRES_SCHEMA, PostgresStoreAdapter } from '../src/postgres-adapter.js';

test('tenant API key revoke and rotate cannot cross tenant boundaries', () => {
  const base = '/data/data/com.termux/files/home/tmp/ag26-keys';
  const r = new TenantRegistry({ filePath: `${base}-t.json`, keyPath: `${base}-k.json` });
  const a = r.create('A'); const b = r.create('B');
  const ka = r.issueKey(a.id, { scopes: ['admin:*'] });
  assert.equal(r.revoke(ka.id, b.id), null);
  assert.ok(r.authenticate(ka.secret));
  assert.throws(() => r.rotate(ka.id, {}, b.id), /API key not found/);
  const rotated = r.rotate(ka.id, {}, a.id);
  assert.equal(r.authenticate(ka.secret), null);
  assert.equal(r.authenticate(rotated.secret).tenantId, a.id);
});

test('tenant rate limiting is enforced independently from network limits', async () => {
  const r = new TenantRegistry({ filePath:'/data/data/com.termux/files/home/tmp/ag26-rt.json', keyPath:'/data/data/com.termux/files/home/tmp/ag26-rk.json' });
  const t = r.create('A'); const k = r.issueKey(t.id, { scopes:['runs:read'] });
  const cp = createControlPlane({ tenantRegistry:r, authRequired:true, rateLimit:100, tenantRateLimit:1, persistence:'/data/data/com.termux/files/home/tmp/ag26-cp' });
  await new Promise(resolve => cp.server.listen(0, resolve));
  const port = cp.server.address().port;
  try {
    const headers={authorization:`Bearer ${k.secret}`};
    assert.equal((await fetch(`http://127.0.0.1:${port}/api/runs`,{headers})).status,200);
    assert.equal((await fetch(`http://127.0.0.1:${port}/api/runs`,{headers})).status,429);
  } finally { cp.server.close(); }
});

test('OIDC clock tolerance is applied to exp and nbf', () => {
  const secret='secret'; const now=Math.floor(Date.now()/1000);
  const enc=v=>Buffer.from(JSON.stringify(v)).toString('base64url');
  const header=enc({alg:'HS256',typ:'JWT'}); const payload=enc({sub:'u',iss:'https://issuer',aud:'agentgate',exp:now-10,nbf:now+10});
  const input=`${header}.${payload}`; const sig=crypto.createHmac('sha256',secret).update(input).digest('base64url');
  assert.throws(()=>verifyOIDCJWT(`${input}.${sig}`,{secret,issuer:'https://issuer',audience:'agentgate'}), /expired|not active/);
  assert.doesNotThrow(()=>verifyOIDCJWT(`${input}.${sig}`,{secret,issuer:'https://issuer',audience:'agentgate',clockTolerance:15}));
});

test('Postgres schema requires tenant isolation and record versioning', () => {
  assert.match(POSTGRES_SCHEMA,/tenant_id text not null/);
  assert.match(POSTGRES_SCHEMA,/version integer not null default 1/);
  assert.match(POSTGRES_SCHEMA,/agentgate.tenant_id/);
  assert.match(POSTGRES_SCHEMA,/agentgate_tenant_isolation/);
});
