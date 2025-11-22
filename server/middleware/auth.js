import jwt from 'jsonwebtoken';
import prisma from '../utils/prismaClient.js';

/** Centralized cookie config/name */
function getCookieName() {
  return process.env.JWT_COOKIE_NAME || 'foria_jwt';
}

/**
 * Returns the JWT string from (1) cookie [preferred],
 * or (2) Authorization: Bearer ... if you explicitly allow it.
 */
function getTokenFromReq(req, { allowBearer = false } = {}) {
  // 1) Cookie (preferred)
  const cookieToken = req.cookies?.[getCookieName()] || null;
  if (cookieToken) return cookieToken;

  // 2) Optional Bearer header (handy for tools; disabled by default)
  if (allowBearer) {
    const header = req.headers.authorization || '';
    if (header.startsWith('Bearer ')) return header.slice(7);
  }

  return null;
}

const IS_TEST = String(process.env.NODE_ENV || '') === 'test';
const SECRET =
  process.env.JWT_SECRET ||
  (IS_TEST ? 'test_secret' : 'dev_secret');

/**
 * Hydrate req.user from decoded token, optionally refreshing from DB
 * so role/plan reflect latest changes (e.g. test promotes user to ADMIN after login).
 */
async function hydrateUser(decoded) {
  const userId = Number(decoded.id);
  if (!Number.isFinite(userId) || userId <= 0) {
    // fall back to whatever we got; tests sometimes fabricate id 0
    return {
      id: Number(decoded.id),
      username: decoded.username || null,
      role: decoded.role || 'USER',
      email: decoded.email || null,
      plan: decoded.plan || 'FREE',
    };
  }

  // Try to pull freshest data from DB
  try {
    const dbUser = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true, username: true, role: true, plan: true },
    });

    if (dbUser) {
      return {
        id: dbUser.id,
        username: dbUser.username || decoded.username || null,
        role: dbUser.role || decoded.role || 'USER',
        email: dbUser.email || decoded.email || null,
        plan: dbUser.plan || decoded.plan || 'FREE',
      };
    }
  } catch {
    // ignore prisma errors in tests
  }

  // fallback to cookie only if DB couldn't confirm
  return {
    id: userId,
    username: decoded.username || null,
    role: decoded.role || 'USER',
    email: decoded.email || null,
    plan: decoded.plan || 'FREE',
  };
}

/** Strict auth: requires a valid JWT; attaches req.user */
export async function requireAuth(req, res, next) {
  try {
    // 🔒 Always drive auth from the JWT cookie, ignore any pre-set req.user
    const token = getTokenFromReq(req, { allowBearer: false });
    if (!token) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    let decoded;
    try {
      decoded = jwt.verify(token, SECRET);
    } catch {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    if (!decoded?.id) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    req.user = await hydrateUser(decoded);
    return next();
  } catch {
    return res.status(401).json({ error: 'Unauthorized' });
  }
}

/** Soft auth: sets req.user if token is valid; otherwise continues */
export async function verifyTokenOptional(req, _res, next) {
  try {
    // don't clobber if already present
    if (req.user && req.user.id) return next();

    const token = getTokenFromReq(req, { allowBearer: false });
    if (!token) return next();

    let decoded;
    try {
      decoded = jwt.verify(token, SECRET);
    } catch {
      return next();
    }

    if (decoded?.id) {
      req.user = await hydrateUser(decoded);
    }
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
