import jwt from 'jsonwebtoken';
import crypto from 'node:crypto';
import { hasVerifiedAdminAccess } from './verifiedAdmin.js';
import prisma from '../utils/prismaClient.js';
import { sessionTokenFromRequest } from '../utils/sessionTokenFromRequest.js';

function getCookieName() {
  return process.env.JWT_COOKIE_NAME || 'foria_jwt';
}

const IS_TEST = String(process.env.NODE_ENV || '') === 'test';
if (!process.env.JWT_SECRET && process.env.NODE_ENV === 'production') {
  throw new Error('JWT_SECRET is required in production');
}
const SECRET = process.env.JWT_SECRET || (IS_TEST ? 'test_secret' : 'dev_secret');

function decodeSession(token) {
  if (!token) return null;
  let decoded;
  try {
    decoded = jwt.verify(token, SECRET, { algorithms: ['HS256'] });
  } catch {
    return null;
  }
  if (!decoded || typeof decoded !== 'object' || Array.isArray(decoded)) return null;
  const typ = decoded.typ;
  // Keep legacy session tokens without typ; reject MFA and other token purposes.
  if (typ != null && typ !== 'session' && typ !== 'short') return null;
  if (!['string', 'number'].includes(typeof decoded.id)) return null;
  const userId = Number(decoded.id);
  const tokenVersion = Number(decoded.tokenVersion ?? 0);
  if (!Number.isSafeInteger(userId) || userId <= 0 || userId > 2147483647 ||
      !Number.isSafeInteger(tokenVersion) || tokenVersion < 0) return null;
  // Short API tokens may authenticate ordinary requests, but must not mint
  // fresh push authority after their parent full session was logged out.
  const pushEligible = typ !== 'short';
  return {
    userId,
    tokenVersion,
    mfaVerified: decoded.mfaVerified === true,
    // Never persist or log the bearer credential. Its fingerprint is scoped
    // to push registration and cannot be used to authenticate API requests.
    pushFingerprint: pushEligible ? crypto.createHash('sha256').update(token).digest('hex') : null,
    pushIssuedAtMs: pushEligible && Number.isSafeInteger(decoded.issuedAtMs)
      ? decoded.issuedAtMs
      : pushEligible && Number.isSafeInteger(decoded.iat) ? decoded.iat * 1000 : 0,
    pushExpiresAtMs: pushEligible && Number.isSafeInteger(decoded.exp) ? decoded.exp * 1000 : 0,
  };
}

async function hydrateUser(userId, db = prisma) {
  const user = await db.user.findUnique({
    where: { id: userId },
    select: {
      id: true, email: true, username: true, publicKey: true,
      role: true, plan: true, emailVerifiedAt: true, phoneVerifiedAt: true,
      twoFactorEnabled: true, preferredLanguage: true, theme: true,
      avatarUrl: true, tokenVersion: true, isBanned: true, deletedAt: true,
    },
  });
  if (!user || user.isBanned || user.deletedAt) return null;
  return {
    id: user.id,
    username: user.username ?? null,
    email: user.email ?? null,
    publicKey: user.publicKey ?? null,
    role: user.role ?? 'USER',
    plan: user.plan ?? 'FREE',
    emailVerifiedAt: user.emailVerifiedAt ?? null,
    phoneVerifiedAt: user.phoneVerifiedAt ?? null,
    twoFactorEnabled: Boolean(user.twoFactorEnabled),
    preferredLanguage: user.preferredLanguage ?? 'en',
    theme: user.theme ?? 'dawn',
    avatarUrl: user.avatarUrl ?? null,
    tokenVersion: user.tokenVersion ?? 0,
  };
}

/** Requires a valid session and a current, available database user. */
export async function requireAuth(req, res, next, db = prisma) {
  delete req.user;
  delete req.auth;
  const session = decodeSession(sessionTokenFromRequest(req, getCookieName()));
  if (!session) return res.status(401).json({ error: 'Unauthorized' });
  let user;
  try {
    user = await hydrateUser(session.userId, db);
  } catch {
    // A database outage cannot authorize a request from JWT claims alone.
    return res.status(503).json({ error: 'Authentication temporarily unavailable' });
  }
  if (!user) return res.status(401).json({ error: 'Unauthorized' });
  if (!Number.isSafeInteger(user.tokenVersion) || user.tokenVersion < 0 ||
      session.tokenVersion !== user.tokenVersion) {
    return res.status(401).json({ error: 'invalid_session' });
  }
  req.user = user;
  req.auth = {
    mfaVerified: session.mfaVerified,
    tokenVersion: session.tokenVersion,
    pushFingerprint: session.pushFingerprint,
    pushIssuedAtMs: session.pushIssuedAtMs,
    pushExpiresAtMs: session.pushExpiresAtMs,
  };
  return next();
}

/** Invalid or unavailable authentication continues as an anonymous request. */
export async function verifyTokenOptional(req, _res, next) {
  delete req.user;
  delete req.auth;
  const session = decodeSession(sessionTokenFromRequest(req, getCookieName()));
  if (session) {
    try {
      const user = await hydrateUser(session.userId);
      if (user && Number.isSafeInteger(user.tokenVersion) && user.tokenVersion >= 0 &&
          session.tokenVersion === user.tokenVersion) {
          req.user = user;
          req.auth = {
            mfaVerified: session.mfaVerified,
            tokenVersion: session.tokenVersion,
            pushFingerprint: session.pushFingerprint,
            pushIssuedAtMs: session.pushIssuedAtMs,
            pushExpiresAtMs: session.pushExpiresAtMs,
          };
        }
    } catch {
      // Continue anonymously during database failures.
    }
  }
  return next();
}

/** Use after requireAuth so the role comes from the current database row. */
export function requireAdmin(req, res, next) {
  if (!req.user || req.user.role !== 'ADMIN') {
    return res.status(403).json({ error: 'Admin access required' });
  }
  if (!req.user.twoFactorEnabled) {
    return res.status(403).json({
      error: 'Administrator two-factor authentication required',
      reason: '2fa_required',
    });
  }
  if (!hasVerifiedAdminAccess(req)) {
    return res.status(403).json({
      error: 'MFA-verified administrator session required',
      reason: 'mfa_verification_required',
    });
  }
  return next();
}

export default requireAuth;
