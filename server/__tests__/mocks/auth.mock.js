import jwt from 'jsonwebtoken';
import { decodeSession } from '../../utils/sessionAuthority.js';

export const requireAuth = (req, _res, next) => {
  const headerId = req.headers['x-test-user-id'];
  const id = headerId ? Number(headerId) : 1;

  req.user = req.user || {
    id,
    role: req.headers['x-test-role'] || 'USER',
    plan: req.headers['x-test-plan'] || 'FREE',
  };

  // Match the production request's session metadata for route tests that
  // exercise push revocation; retain x-test-user-id for unrelated fixtures.
  const token = req.cookies?.[process.env.JWT_COOKIE_NAME || 'foria_jwt'] ||
    /^Bearer\s+(\S+)$/i.exec(req.headers.authorization || '')?.[1];
  if (token) {
    try {
      const claims = jwt.verify(token, process.env.JWT_SECRET || 'test_secret',
        { algorithms: ['HS256'] });
      if (Number(claims.id) !== id) throw new Error('Synthetic account mismatch');
      const session = decodeSession(token);
      if (!session) throw new Error('Invalid synthetic session');
      req.auth = {
        sessionKind: session.sessionKind,
        authorityFingerprint: session.authorityFingerprint,
        authorityExpiresAtMs: session.authorityExpiresAtMs,
        mfaVerified: session.mfaVerified,
        pushFingerprint: session.pushFingerprint,
        pushIssuedAtMs: session.pushIssuedAtMs,
        pushExpiresAtMs: session.pushExpiresAtMs,
        tokenVersion: session.tokenVersion,
      };
    } catch { /* Other route fixtures may use synthetic credentials. */ }
  }

  next();
};

export const verifyTokenOptional = (req, _res, next) => {
  if (!req.user && req.headers['x-test-user-id']) {
    req.user = {
      id: Number(req.headers['x-test-user-id']),
      role: req.headers['x-test-role'] || 'USER',
      plan: req.headers['x-test-plan'] || 'FREE',
    };
  }

  next();
};

export const requireAdmin = (req, res, next) => {
  if (!req.user) {
    req.user = {
      id: 1,
      role: req.headers['x-test-role'] || 'ADMIN',
      plan: req.headers['x-test-plan'] || 'FREE',
    };
  }

  if (req.user.role !== 'ADMIN') {
    return res.status(403).json({ error: 'Admin access required' });
  }

  next();
};

export default requireAuth;
