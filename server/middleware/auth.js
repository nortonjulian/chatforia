import jwt from 'jsonwebtoken';
import prisma from '../utils/prismaClient.js';

/** Centralized cookie config/name */
function getCookieName() {
  return process.env.JWT_COOKIE_NAME || 'foria_jwt';
}

/**
 * Returns the JWT string from the cookie (preferred).
 * Supports Authorization: Bearer for mobile / API clients.
 */
function getTokenFromReq(req) {
  const cookieToken = req.cookies?.[getCookieName()] || null;
  if (cookieToken) return cookieToken;

  const header = req.headers.authorization || '';
  if (header.startsWith('Bearer ')) return header.slice(7);

  return null;
}

const IS_TEST = String(process.env.NODE_ENV || '') === 'test';
const SECRET =
  process.env.JWT_SECRET ||
  (IS_TEST ? 'test_secret' : 'dev_secret');

async function hydrateUser(decoded) {
  const userId = Number(decoded.id);
  if (!Number.isFinite(userId) || userId <= 0) {
    return {
      id: Number(decoded.id),
      username: decoded.username || null,
      role: decoded.role || 'USER',
      email: decoded.email || null,
      plan: decoded.plan || 'FREE',
      emailVerifiedAt: decoded.emailVerifiedAt || null,
      phoneVerifiedAt: decoded.phoneVerifiedAt || null,
      twoFactorEnabled: !!decoded.twoFactorEnabled,
      preferredLanguage: decoded.preferredLanguage || 'en',
      theme: decoded.theme || 'dawn',
      avatarUrl: decoded.avatarUrl || null,
      tokenVersion: Number(decoded.tokenVersion ?? 0),
    };
  }

  try {
    const dbUser = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        username: true,
        role: true,
        plan: true,
        emailVerifiedAt: true,
        phoneVerifiedAt: true,
        twoFactorEnabled: true,
        preferredLanguage: true,
        theme: true,
        avatarUrl: true,
        tokenVersion: true,
      },
    });

    if (dbUser) {
      return {
        id: dbUser.id,
        username: dbUser.username || decoded.username || null,
        role: dbUser.role || decoded.role || 'USER',
        email: dbUser.email || decoded.email || null,
        plan: dbUser.plan || decoded.plan || 'FREE',
        emailVerifiedAt: dbUser.emailVerifiedAt || null,
        phoneVerifiedAt: dbUser.phoneVerifiedAt || null,
        twoFactorEnabled: !!dbUser.twoFactorEnabled,
        preferredLanguage: dbUser.preferredLanguage || 'en',
        theme: dbUser.theme || 'dawn',
        avatarUrl: dbUser.avatarUrl || null,
        tokenVersion: Number(dbUser.tokenVersion ?? 0),
      };
    }
  } catch {
    // ignore prisma errors in tests / transient DB issues
  }

  return {
    id: userId,
    username: decoded.username || null,
    role: decoded.role || 'USER',
    email: decoded.email || null,
    plan: decoded.plan || 'FREE',
    emailVerifiedAt: decoded.emailVerifiedAt || null,
    phoneVerifiedAt: decoded.phoneVerifiedAt || null,
    twoFactorEnabled: !!decoded.twoFactorEnabled,
    preferredLanguage: decoded.preferredLanguage || 'en',
    theme: decoded.theme || 'dawn',
    avatarUrl: decoded.avatarUrl || null,
    tokenVersion: Number(decoded.tokenVersion ?? 0),
  };
}

function isAllowedAuthToken(decoded) {
  const typ = decoded?.typ;
  return !typ || typ === 'session' || typ === 'short';
}

/** Strict auth: requires a valid JWT; attaches req.user */
export async function requireAuth(req, res, next) {
  try {
    const token = getTokenFromReq(req);
    if (!token) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    let decoded;
    try {
      decoded = jwt.verify(token, SECRET);
    } catch {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    if (!decoded?.id || !isAllowedAuthToken(decoded)) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    req.user = await hydrateUser(decoded);

    const jwtTokenVersion = Number(decoded.tokenVersion ?? 0);
    const dbTokenVersion = Number(req.user.tokenVersion ?? 0);
    if (jwtTokenVersion !== dbTokenVersion) {
      return res.status(401).json({ error: 'invalid_session' });
    }

    return next();
  } catch {
    return res.status(401).json({ error: 'Unauthorized' });
  }
}

/** Soft auth: sets req.user if token is valid; otherwise continues */
export async function verifyTokenOptional(req, _res, next) {
  try {
    if (req.user && req.user.id) return next();

    const token = getTokenFromReq(req);
    if (!token) return next();

    let decoded;
    try {
      decoded = jwt.verify(token, SECRET);
    } catch {
      return next();
    }

    if (!decoded?.id || !isAllowedAuthToken(decoded)) {
      return next();
    }

    const hydrated = await hydrateUser(decoded);

    const jwtTokenVersion = Number(decoded.tokenVersion ?? 0);
    const dbTokenVersion = Number(hydrated.tokenVersion ?? 0);
    if (jwtTokenVersion !== dbTokenVersion) {
      return next();
    }

    req.user = hydrated;
  } catch {
    // ignore invalid/expired tokens
  }

  next();
}

/** Admin gate: requires req.user.role === 'ADMIN'. Use after requireAuth */
export function requireAdmin(req, res, next) {
  if (!req.user || req.user.role !== 'ADMIN') {
    return res.status(403).json({ error: 'Admin access required' });
  }
  next();
}

export default requireAuth;
