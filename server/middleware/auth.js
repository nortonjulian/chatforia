import jwt from 'jsonwebtoken';
import prisma from '../utils/prismaClient.js';

function getCookieName() {
  return process.env.JWT_COOKIE_NAME || 'foria_jwt';
}

// Preserve cookie precedence for browser clients; mobile clients use Bearer.
function getTokenFromReq(req) {
  const cookieToken = req.cookies?.[getCookieName()];
  if (typeof cookieToken === 'string' && cookieToken) return cookieToken;
  const header = req.headers?.authorization;
  if (typeof header !== 'string') return null;
  const match = /^Bearer\s+(\S+)\s*$/i.exec(header);
  return match?.[1] || null;
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
  return { userId, tokenVersion };
}

async function hydrateUser(userId) {
  const user = await prisma.user.findUnique({
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
export async function requireAuth(req, res, next) {
  delete req.user;
  const session = decodeSession(getTokenFromReq(req));
  if (!session) return res.status(401).json({ error: 'Unauthorized' });
  let user;
  try {
    user = await hydrateUser(session.userId);
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
  return next();
}

/** Invalid or unavailable authentication continues as an anonymous request. */
export async function verifyTokenOptional(req, _res, next) {
  delete req.user;
  const session = decodeSession(getTokenFromReq(req));
  if (session) {
    try {
      const user = await hydrateUser(session.userId);
      if (user && Number.isSafeInteger(user.tokenVersion) && user.tokenVersion >= 0 &&
          session.tokenVersion === user.tokenVersion) req.user = user;
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
  return next();
}

export default requireAuth;
