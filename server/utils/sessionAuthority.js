import crypto from 'node:crypto';

import jwt from 'jsonwebtoken';

const IS_TEST = String(process.env.NODE_ENV || '') === 'test';
if (!process.env.JWT_SECRET && process.env.NODE_ENV === 'production') {
  throw new Error('JWT_SECRET is required in production');
}
const SECRET = process.env.JWT_SECRET || (IS_TEST ? 'test_secret' : 'dev_secret');

const FINGERPRINT = /^[a-f0-9]{64}$/;

export function fingerprintSession(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export function decodeSession(token) {
  if (!token) return null;
  let decoded;
  try {
    decoded = jwt.verify(token, SECRET, { algorithms: ['HS256'] });
  } catch {
    return null;
  }
  if (!decoded || typeof decoded !== 'object' || Array.isArray(decoded)) return null;
  const typ = decoded.typ;
  if (typ != null && typ !== 'session' && typ !== 'short') return null;
  if (!['string', 'number'].includes(typeof decoded.id)) return null;
  const userId = Number(decoded.id);
  const tokenVersion = Number(decoded.tokenVersion ?? 0);
  if (!Number.isSafeInteger(userId) || userId <= 0 || userId > 2147483647 ||
      !Number.isSafeInteger(tokenVersion) || tokenVersion < 0) return null;
  const authority = authorityForClaims(token, decoded);
  if (!authority) return null;
  const pushEligible = typ !== 'short';
  return {
    userId, tokenVersion,
    authorityFingerprint: authority.fingerprint,
    sessionKind: authority.kind,
    authorityExpiresAtMs: authority.expiresAtMs,
    mfaVerified: decoded.mfaVerified === true,
    pushFingerprint: pushEligible ? authority.fingerprint : null,
    pushIssuedAtMs: pushEligible && Number.isSafeInteger(decoded.issuedAtMs)
      ? decoded.issuedAtMs : pushEligible && Number.isSafeInteger(decoded.iat) ? decoded.iat * 1000 : 0,
    pushExpiresAtMs: pushEligible && Number.isSafeInteger(decoded.exp) ? decoded.exp * 1000 : 0,
  };
}

// Short credentials are signed JWTs, but their parent authority must remain
// current. Older, unbound short credentials cannot be safely attributed to a
// logged-out session and therefore cannot authenticate after this rollout.
export function authorityForClaims(token, claims) {
  if (claims.typ === 'short') {
    const fingerprint = claims.parentSessionFingerprint;
    const expiresAtMs = claims.parentSessionExpiresAt;
    if (typeof fingerprint !== 'string' || !FINGERPRINT.test(fingerprint) ||
        !Number.isSafeInteger(expiresAtMs) || expiresAtMs <= Date.now() ||
        !Number.isSafeInteger(claims.exp) || claims.exp * 1000 > expiresAtMs) return null;
    return { fingerprint, kind: 'short', expiresAtMs };
  }
  if (!Number.isSafeInteger(claims.exp) || claims.exp * 1000 <= Date.now()) return null;
  return { fingerprint: fingerprintSession(token), kind: 'session', expiresAtMs: claims.exp * 1000 };
}

export async function isSessionRevoked(db, fingerprint) {
  // Missing tables, permissions, and database outages must not authorize a
  // request. Callers translate an exception to 503 or a failed socket check.
  const row = await db.pushSessionRevocation.findUnique({
    where: { sessionFingerprint: fingerprint }, select: { sessionFingerprint: true },
  });
  return Boolean(row);
}
