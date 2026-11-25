import { hasVerifiedAdminAccess } from './verifiedAdmin.js';
import prisma from '../utils/prismaClient.js';
import { sessionTokenFromRequest } from '../utils/sessionTokenFromRequest.js';
import { decodeSession, isSessionRevoked } from '../utils/sessionAuthority.js';

function getCookieName() {
  return process.env.JWT_COOKIE_NAME || 'foria_jwt';
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
  try {
    if (await isSessionRevoked(db, session.authorityFingerprint)) {
      return res.status(401).json({ error: 'invalid_session' });
    }
  } catch {
    return res.status(503).json({ error: 'Authentication temporarily unavailable' });
  }
  req.user = user;
  req.auth = {
    sessionKind: session.sessionKind,
    authorityFingerprint: session.authorityFingerprint,
    authorityExpiresAtMs: session.authorityExpiresAtMs,
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
          session.tokenVersion === user.tokenVersion &&
          !(await isSessionRevoked(prisma, session.authorityFingerprint))) {
          req.user = user;
          req.auth = {
            sessionKind: session.sessionKind,
            authorityFingerprint: session.authorityFingerprint,
            authorityExpiresAtMs: session.authorityExpiresAtMs,
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
