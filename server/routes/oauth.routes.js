import { Router } from 'express';
import jwt from 'jsonwebtoken';
import passport from '../auth/passport.js';

const router = Router();
const isProd = process.env.NODE_ENV === 'production';
const FRONTEND = process.env.FRONTEND_URL || process.env.FRONTEND_ORIGIN || 'http://localhost:5173';

// Health/debug
router.get('/health', (_req, res) => res.json({ ok: true, oauth: true }));

/* ---------- GOOGLE (unchanged except using state) ---------- */
router.get('/google', (req, res, next) => {
  if (!passport._strategy('google')) {
    return res.status(501).json({ error: 'Google OAuth not configured' });
  }
  const state = req.query.state || '';
  return passport.authenticate('google', {
    scope: ['profile', 'email'],
    session: false,
    state,
  })(req, res, next);
});

router.get('/google/callback',
  (req, res, next) => {
    if (!passport._strategy('google')) {
      return res.status(501).json({ error: 'Google OAuth not configured' });
    }
    next();
  },
  passport.authenticate('google', { failureRedirect: '/auth/failure', session: false }),
  (req, res) => {
    const token = jwt.sign({ sub: req.user.id }, process.env.JWT_SECRET || 'dev-secret', { expiresIn: '30d' });
    const cookie = {
      httpOnly: true,
      secure: isProd,
      sameSite: isProd ? 'none' : 'lax',
      maxAge: 30 * 24 * 3600 * 1000,
      ...(isProd && process.env.COOKIE_DOMAIN ? { domain: process.env.COOKIE_DOMAIN } : {}),
    };
    res.cookie('cf_session', token, cookie);

    let nextUrl = FRONTEND;
    try {
      if (req.query.state) {
        const { next } = JSON.parse(Buffer.from(req.query.state, 'base64').toString('utf8'));
        if (typeof next === 'string' && next.startsWith('http')) nextUrl = next;
      }
    } catch {}
    res.redirect(nextUrl);
  }
);

/* ---------- APPLE ---------- */
router.get('/apple', (req, res, next) => {
  if (!passport._strategy('apple')) {
    return res.status(501).json({ error: 'Apple OAuth not configured' });
  }
  const state = req.query.state || '';
  return passport.authenticate('apple', {
    scope: ['name', 'email'],
    session: false,
    state,
  })(req, res, next);
});

// Apple typically POSTs the callback
router.post('/apple/callback',
  (req, res, next) => {
    if (!passport._strategy('apple')) {
      return res.status(501).json({ error: 'Apple OAuth not configured' });
    }
    next();
  },
  passport.authenticate('apple', { failureRedirect: '/auth/failure', session: false }),
  (req, res) => {
    const token = jwt.sign({ sub: req.user.id }, process.env.JWT_SECRET || 'dev-secret', { expiresIn: '30d' });
    const cookie = {
      httpOnly: true,
      secure: isProd,
      sameSite: isProd ? 'none' : 'lax',
      maxAge: 30 * 24 * 3600 * 1000,
      ...(isProd && process.env.COOKIE_DOMAIN ? { domain: process.env.COOKIE_DOMAIN } : {}),
    };
    res.cookie('cf_session', token, cookie);

    let nextUrl = FRONTEND;
    try {
      if (req.query.state) {
        const { next } = JSON.parse(Buffer.from(req.query.state, 'base64').toString('utf8'));
        if (typeof next === 'string' && next.startsWith('http')) nextUrl = next;
      }
    } catch {}
    res.redirect(nextUrl);
  }
);

router.get('/failure', (_req, res) => res.status(401).send('SSO failed'));

// Enhanced debug
router.get('/debug', (_req, res) => {
  res.json({
    hasGoogle: !!passport._strategy('google'),
    hasApple: !!passport._strategy('apple'),
    envSeen: {
      GOOGLE_CLIENT_ID: !!process.env.GOOGLE_CLIENT_ID,
      GOOGLE_CLIENT_SECRET: !!process.env.GOOGLE_CLIENT_SECRET,
      GOOGLE_CALLBACK_URL: !!process.env.GOOGLE_CALLBACK_URL,
      APPLE_SERVICE_ID: !!process.env.APPLE_SERVICE_ID,
      APPLE_TEAM_ID: !!process.env.APPLE_TEAM_ID,
      APPLE_KEY_ID: !!process.env.APPLE_KEY_ID,
      APPLE_PRIVATE_KEY_OR_PATH: !!(process.env.APPLE_PRIVATE_KEY || process.env.APPLE_PRIVATE_KEY_PATH),
      APPLE_CALLBACK_URL: !!process.env.APPLE_CALLBACK_URL,
    },
  });
});

export default router;
