import express from 'express';
import bcrypt from 'bcrypt';
import rateLimit from 'express-rate-limit';
import prisma from '../utils/prismaClient.js';
import { newRawToken, hashToken, verifyHash } from '../utils/tokens.js';
import { sendTransactionalEmail } from '../utils/email.js'; // your existing wrapper
import logger from '../utils/logger.js'; // optional

export const router = express.Router();

const TOKEN_TTL_MS = 1000 * 60 * 60 * 24; // 24h for email verify
const BCRYPT_ROUNDS = parseInt(process.env.BCRYPT_ROUNDS || '12', 10);

// ---------- Rate limiters (use Redis/other store in prod) ----------
const createAccountLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 min
  max: 6, // limit account creations per IP
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'too_many_requests' }
});

const resendLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 6,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'too_many_requests' }
});

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'too_many_requests' }
});

// ---------- Helpers ----------
function safeResponse(res) {
  // helper to avoid leaking whether an email exists
  return res.status(200).json({ ok: true });
}

function isValidEmail(email) {
  // simple check - use stronger validation if desired
  return typeof email === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function isStrongPassword(pw) {
  // minimal policy: length >= 8. Expand: uppercase, digits, symbols, entropy.
  return typeof pw === 'string' && pw.length >= 8;
}

// ---------- POST /auth/register ----------
router.post('/register', createAccountLimiter, async (req, res) => {
  try {
    const { email, password, captchaToken } = req.body;

    // TODO: verify captchaToken with your captcha provider if you use one
    // e.g. if (!await verifyCaptcha(captchaToken)) return res.status(400).json({ error: 'captcha' });

    if (!isValidEmail(email) || !isStrongPassword(password)) {
      // don't reveal which field failed in production; keep it slightly friendly for dev/testing
      return res.status(400).json({ error: 'invalid_input' });
    }

    // Hash password
    const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);

    // Create user in "unverified" state. If unique constraint fails, respond with generic OK
    let user;
    try {
      user = await prisma.user.create({
        data: {
          email: email.toLowerCase(),
          passwordHash,
          // emailVerifiedAt left null until verification
        }
      });
    } catch (err) {
      // unique constraint or other DB issue - avoid enumeration
      logger?.warn('register: prisma create error', { err });
      return safeResponse(res);
    }

    // Rotate old verification tokens for this user (mark consumed)
    await prisma.verificationToken.updateMany({
      where: { userId: user.id, type: 'email', consumedAt: null },
      data: { consumedAt: new Date() }
    });

    // create new email verification token
    const raw = newRawToken(); // e.g., crypto.randomBytes(32).toString('hex')
    const tokenHash = await hashToken(raw);
    await prisma.verificationToken.create({
      data: {
        userId: user.id,
        type: 'email',
        tokenHash,
        expiresAt: new Date(Date.now() + TOKEN_TTL_MS)
      }
    });

    // send verification email (do not await failures to leak)
    const link = `${process.env.PUBLIC_BASE_URL.replace(/\/$/, '')}/auth/verify-email?token=${encodeURIComponent(raw)}&uid=${user.id}`;
    try {
      await sendTransactionalEmail(email, 'Verify your Chatforia email', {
        template: 'verify-email',
        substitutions: { link }
      });
    } catch (err) {
      logger?.error('register: email send failed', { err });
      // still return 200 — you may want to surface in admin metrics
    }

    return safeResponse(res);
  } catch (err) {
    logger?.error('register: unexpected error', { err });
    return res.status(500).json({ error: 'server_error' });
  }
});

// ---------- GET /auth/verify-email ----------
router.get('/verify-email', async (req, res) => {
  try {
    const { token, uid } = req.query;
    if (!token || !uid) return res.status(400).send('Invalid or expired');

    const userId = Number(uid);
    if (Number.isNaN(userId)) return res.status(400).send('Invalid or expired');

    // Find the most recent unconsumed token record for that user (type=email)
    const record = await prisma.verificationToken.findFirst({
      where: {
        userId,
        type: 'email',
        consumedAt: null,
        expiresAt: { gt: new Date() }
      },
      orderBy: { createdAt: 'desc' }
    });

    if (!record) return res.status(400).send('Invalid or expired');

    const ok = await verifyHash(token, record.tokenHash);
    if (!ok) return res.status(400).send('Invalid or expired');

    // Mark token consumed and set user's emailVerifiedAt (atomic)
    await prisma.$transaction([
      prisma.verificationToken.update({
        where: { id: record.id },
        data: { consumedAt: new Date() }
      }),
      prisma.user.update({
        where: { id: userId },
        data: { emailVerifiedAt: new Date() }
      })
    ]);

    // Redirect back to the app - include a short success flag for the client to show UI
    const redirectUrl = process.env.APP_URL ? `${process.env.APP_URL.replace(/\/$/, '')}/?verified=1` : '/?verified=1';
    return res.redirect(redirectUrl);
  } catch (err) {
    logger?.error('verify-email: error', { err });
    return res.status(500).send('Server error');
  }
});

// ---------- POST /auth/resend-email ----------
router.post('/resend-email', resendLimiter, async (req, res) => {
  try {
    const { email } = req.body;
    if (!isValidEmail(email)) return safeResponse(res);

    // Always respond with OK to avoid enumeration
    const user = await prisma.user.findUnique({ where: { email: email.toLowerCase() } });
    if (!user) return safeResponse(res);

    // If already verified, do nothing (but return OK)
    if (user.emailVerifiedAt) return safeResponse(res);

    // Rate-limit per-account: you can store lastResendAt in user row or use a Redis key.
    // Here we implement rotation: consume previous tokens and create a new one.
    await prisma.verificationToken.updateMany({
      where: { userId: user.id, type: 'email', consumedAt: null },
      data: { consumedAt: new Date() }
    });

    const raw = newRawToken();
    const tokenHash = await hashToken(raw);
    await prisma.verificationToken.create({
      data: {
        userId: user.id,
        type: 'email',
        tokenHash,
        expiresAt: new Date(Date.now() + TOKEN_TTL_MS)
      }
    });

    const link = `${process.env.PUBLIC_BASE_URL.replace(/\/$/, '')}/auth/verify-email?token=${encodeURIComponent(raw)}&uid=${user.id}`;
    try {
      await sendTransactionalEmail(user.email, 'Verify your Chatforia email - resend', {
        template: 'verify-email',
        substitutions: { link }
      });
    } catch (err) {
      logger?.error('resend-email: email send failed', { err });
      // swallow
    }

    return safeResponse(res);
  } catch (err) {
    logger?.error('resend-email: error', { err });
    return res.status(500).json({ ok: true });
  }
});

// ---------- POST /auth/login (password verify) ----------
router.post('/login', loginLimiter, async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!isValidEmail(email) || typeof password !== 'string') {
      // Use generic response
      return res.status(401).json({ error: 'invalid_credentials' });
    }

    const user = await prisma.user.findUnique({ where: { email: email.toLowerCase() } });

    // Protect against timing attacks/user enumeration by always doing a bcrypt compare
    // even if user doesn't exist - compare against a static hash.
    const dummyHash = '$2b$12$C6UzMDM.H6dfI/f/IKcEeOLv7qGq5R8K1q5Ztq6Vq1K0Y7tZfQG2'; // random bcrypt hash
    const passwordHash = user ? user.passwordHash : dummyHash;
    const passwordOk = await bcrypt.compare(password, passwordHash);

    if (!user || !passwordOk) {
      return res.status(401).json({ error: 'invalid_credentials' });
    }

    if (!user.emailVerifiedAt) {
      // Optionally include a flag to trigger "resend verify" UI on client
      return res.status(403).json({ error: 'email_not_verified' });
    }

    // Issue JWT (replace createJwtForUser with your implementation)
    // const token = createJwtForUser(user);
    // return res.json({ token });

    // Placeholder response:
    return res.json({ ok: true, message: 'login_success_placeholder' });
  } catch (err) {
    logger?.error('login: error', { err });
    return res.status(500).json({ error: 'server_error' });
  }
});

export default router;