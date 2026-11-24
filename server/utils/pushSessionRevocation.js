import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';

const IS_TEST = process.env.NODE_ENV === 'test';
if (!process.env.JWT_SECRET && process.env.NODE_ENV === 'production') {
  throw new Error('JWT_SECRET is required in production');
}
const SECRET = process.env.JWT_SECRET || (IS_TEST ? 'test_secret' : 'dev_secret');

// Logout can revoke an expired but authentic session. Invalid and unrelated
// token types never create durable tombstones in the push authority table.
export function pushSessionRevocationFromToken(token) {
  if (typeof token !== 'string' || !token || token.length > 4096) return null;
  let claims;
  try {
    claims = jwt.verify(token, SECRET, { algorithms: ['HS256'], ignoreExpiration: true });
  } catch {
    return null;
  }
  if (!claims || typeof claims !== 'object' || Array.isArray(claims) ||
      (claims.typ != null && !['session', 'short'].includes(claims.typ)) ||
      !Number.isSafeInteger(Number(claims.id)) || Number(claims.id) <= 0 ||
      !Number.isSafeInteger(claims.exp)) return null;
  const expiresMs = claims.exp * 1000;
  if (!Number.isSafeInteger(expiresMs) || expiresMs <= 0) return null;
  return {
    fingerprint: crypto.createHash('sha256').update(token).digest('hex'),
    expiresAt: new Date(expiresMs),
  };
}
