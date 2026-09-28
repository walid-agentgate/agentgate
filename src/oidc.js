import crypto from 'node:crypto';

export function mapOIDCClaims(claims={}, options={}) {
  const rolesClaim=options.rolesClaim||'roles'; const tenantClaim=options.tenantClaim||'tenant_id'; const subjectClaim=options.subjectClaim||'sub';
  return { userId:claims[subjectClaim]||null, tenantId:claims[tenantClaim]||null, roles:Array.isArray(claims[rolesClaim])?claims[rolesClaim]:[], attributes:{issuer:claims.iss||null,email:claims.email||null}, claims };
}
export function validateOIDCIdentity(identity, tenantId){ return Boolean(identity?.userId&&identity?.tenantId&&identity.tenantId===tenantId); }

export function decodeJWT(token) {
  const parts = String(token || '').split('.');
  if (parts.length !== 3) throw new Error('Invalid JWT format');
  const decode = value => JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
  return { header: decode(parts[0]), payload: decode(parts[1]), signingInput: `${parts[0]}.${parts[1]}`, signature: Buffer.from(parts[2], 'base64url') };
}

export function verifyOIDCJWT(token, options = {}) {
  const { header, payload, signingInput, signature } = decodeJWT(token);
  const algorithms = options.algorithms || ['RS256', 'ES256', 'HS256'];
  if (!algorithms.includes(header.alg)) throw new Error('JWT algorithm is not allowed');
  if (options.issuer && payload.iss !== options.issuer) throw new Error('JWT issuer mismatch');
  if (options.audience) {
    const audiences = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
    if (!audiences.includes(options.audience)) throw new Error('JWT audience mismatch');
  }
  const now = Math.floor(Date.now() / 1000);
  const tolerance = Math.max(0, Number(options.clockTolerance || 0));
  if (payload.exp != null && now >= Number(payload.exp) + tolerance) throw new Error('JWT expired');
  if (payload.nbf != null && now < Number(payload.nbf) - tolerance) throw new Error('JWT not active');
  if (options.maxTokenAge != null && payload.iat != null && now - Number(payload.iat) > Number(options.maxTokenAge) + tolerance) throw new Error('JWT too old');
  const key = options.publicKey || options.secret;
  if (!key) throw new Error('JWT verification key is required');
  let valid = false;
  if (header.alg === 'HS256') { const expected = crypto.createHmac('sha256', key).update(signingInput).digest(); valid = signature.length === expected.length && crypto.timingSafeEqual(signature, expected); }
  else if (header.alg === 'RS256') valid = crypto.verify('RSA-SHA256', Buffer.from(signingInput), key, signature);
  else if (header.alg === 'ES256') { if (signature.length !== 64) throw new Error('Invalid ES256 signature'); const r = signature.subarray(0, 32); const sPart = signature.subarray(32); const int = b => { let x = Buffer.from(b); while (x.length > 1 && x[0] === 0) x = x.subarray(1); if (x[0] & 0x80) x = Buffer.concat([Buffer.from([0]), x]); return Buffer.concat([Buffer.from([0x02, x.length]), x]); }; const body = Buffer.concat([int(r), int(sPart)]); const der = Buffer.concat([Buffer.from([0x30, body.length]), body]); valid = crypto.verify('sha256', Buffer.from(signingInput), { key, dsaEncoding: 'der' }, der); }
  if (!valid) throw new Error('JWT signature verification failed');
  return payload;
}
