import express from 'express';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import crypto from 'node:crypto';
import { z } from 'zod';

import prisma from '../utils/prismaClient.js';
import { requireAuth } from '../middleware/auth.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { sendMail } from '../utils/sendMail.js';

// CSRF cookie refresher on GETs is handled in app.js; we also expose an explicit 200 endpoint here.
import { setCsrfCookie } from '../middleware/csrf.js';

// 2FA deps
import speakeasy from 'speakeasy';
import { open } from '../utils/secretBox.js'; // AES-GCM decrypt of totpSecretEnc
import rateLimit from 'express-rate-limit';
import { body, validationResult } from 'express-validator';
import { sendSms } from '../lib/telco/index.js';
import { normalizeE164 } from '../utils/phone.js';

// Token helpers for resend-email
import { newRawToken, hashToken } from '../utils/tokens.js';
import { consumeEmailVerification, createPhoneVerification, consumePhoneVerification } from '../services/authVerification.js';

const RegisterSchema = z.object({
  username: z.string()
    .trim()
    .min(3)
    .max(20)
    .regex(
      /^[a-zA-Z0-9_]+$/,
      'Username can only contain letters, numbers, and underscores'
    ),
  email: z.string().trim().email().toLowerCase(),
  password: z.string().min(8),
  preferredLanguage: z.string().optional(),
});

import { generateKeyPair } from '../utils/encryption.js';
import { issueResetToken, consumeResetToken } from '../utils/resetTokens.js';

import { serializeUser } from '../utils/serializeUser.js';
import { canForwardVoicemailEmail } from '../utils/voicemailForwarding.js';
import { createMfaChallenge, completeMfaChallenge } from '../services/mfaLogin.js';
import { renderMfaPage, MFA_BROWSER_SCRIPT, MFA_BROWSER_CSS, pendingCookieName, pendingCookieOptions } from '../services/webMfa.js';

const router = express.Router();

// Reject legacy case-insensitive duplicates instead of choosing an account.
async function findUniqueLoginIdentity(field, value) {
  const normalizedField = field === 'email' ? 'emailNorm' : 'usernameNorm';
  const candidates = await prisma.user.findMany({
    where: {
      deletedAt: null,
      OR: [
        { [normalizedField]: value.toLowerCase() },
        { [field]: { equals: value, mode: 'insensitive' } },
      ],
    },
    take: 2,
  });
  if (candidates.length > 1) {
    const err = new Error('Ambiguous login identity');
    err.code = 'ambiguous_login_identity';
    throw err;
  }
  return candidates[0] ?? null;
}


const IS_TEST = String(process.env.NODE_ENV) === 'test';
if (!process.env.JWT_SECRET && process.env.NODE_ENV === 'production') {
  throw new Error('JWT_SECRET is required in production');
}

const JWT_SECRET =
  process.env.JWT_SECRET ||
  (IS_TEST ? 'test_secret' : 'dev_secret');

/* ---------------- cookie helpers ---------------- */
function getCookieName() {
  // Set JWT_COOKIE_NAME=cf_session in .env/.env.production
  return process.env.JWT_COOKIE_NAME || 'foria_jwt';
}

function getCookieBase() {
  const isProd = process.env.NODE_ENV === 'production';

  const cookieDomain = isProd ? process.env.COOKIE_DOMAIN : undefined;

  return {
    httpOnly: true,
    path: '/',
    secure: isProd,
    sameSite: isProd ? 'none' : 'lax',
    ...(cookieDomain ? { domain: cookieDomain } : {}),
  };
}

function setJwtCookie(res, token) {
  const isProd = process.env.NODE_ENV === 'production';
  const base = getCookieBase();
  const opts = isProd ? { ...base, maxAge: 30 * 24 * 3600 * 1000 } : base;
  res.cookie(getCookieName(), token, opts);
}

function clearAllAuthCookies(res) {
  const names = ['foria_jwt', 'cf_session'];

  const domains = [
    undefined,
    '.chatforia.com',
    'chatforia.com',
    'api.chatforia.com',
  ];

  for (const name of names) {
    for (const domain of domains) {
      const base = {
        httpOnly: true,
        path: '/',
        secure: true,
        sameSite: 'none',
        ...(domain ? { domain } : {}),
      };

      res.clearCookie(name, base);
      res.cookie(name, '', {
        ...base,
        maxAge: 0,
        expires: new Date(0),
      });
    }
  }
}

/* =========================
 *        2FA helpers
 * ========================= */
function sha256(s) {
  return crypto.createHash('sha256').update(s, 'utf8').digest('hex');
}

export function issueSession(res, user, { mfaVerified = false } = {}) {
  if (!user || user.isBanned || user.deletedAt || !Number.isSafeInteger(Number(user.id)) || Number(user.id) <= 0) {
    throw new Error('Session account unavailable');
  }
  if (user.twoFactorEnabled && !mfaVerified) throw new Error('MFA must complete before session issuance');
  const payload = {
    id: Number(user.id),
    email: user.email,
    username: user.username,
    role: user.role,
    plan: user.plan,
    tokenVersion: user.tokenVersion ?? 0,
    typ: 'session',
  };

  const token = jwt.sign(payload, JWT_SECRET, { expiresIn: '30d' });

  setJwtCookie(res, token);

  return token;
}

function pickKeyBackupFields(user) {
  return {
    publicKey: user.publicKey ?? null,
    encryptedPrivateKeyBundle: user.encryptedPrivateKeyBundle ?? null,
    privateKeyWrapSalt: user.privateKeyWrapSalt ?? null,
    privateKeyWrapKdf: user.privateKeyWrapKdf ?? null,
    privateKeyWrapIterations: user.privateKeyWrapIterations ?? null,
    privateKeyWrapVersion: user.privateKeyWrapVersion ?? null,
  };
}

/* =========================
 *         CSRF
 * ========================= */
router.get('/csrf', (req, res) => {
  setCsrfCookie(req, res);
  res.json({ ok: true });
});

router.get('/csrf-token', (req, res) => {
  setCsrfCookie(req, res);
  res.json({ ok: true });
});

/* =========================
 *         REGISTER
 * ========================= */
router.post(
  '/register',
  asyncHandler(async (req, res) => {
    const parsed = RegisterSchema.safeParse(req.body || {});
    if (!parsed.success) {
      return res
        .status(422)
        .json({ message: 'Invalid registration data', details: parsed.error.issues });
    }
    const { username, email, password, preferredLanguage = 'en' } = parsed.data;
    const usernameNorm = username.toLowerCase();
    const emailNorm = email.toLowerCase();
    const existingByEmail = await prisma.user.findFirst({
      where: {
        OR: [
          { emailNorm },
          { email: { equals: email, mode: 'insensitive' } },
        ],
      },
    });
    if (existingByEmail) {
      return res.status(409).json({ error: 'Email already in use' });
    }

    const existingByUsername = await prisma.user.findFirst({
      where: {
        OR: [
          { usernameNorm },
          { username: { equals: username, mode: 'insensitive' } },
        ],
      },
    });

    if (existingByUsername) {
      return res.status(409).json({ error: 'Username already in use' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const { publicKey, privateKey } = generateKeyPair();

    const user = await prisma.$transaction(async (tx) => {
      const created = await tx.user.create({
      data: {
        username,
        email,
        usernameNorm,
        emailNorm,
        passwordHash: hashedPassword,
        preferredLanguage,
        role: 'USER',
        plan: 'FREE',
        publicKey,
      },
      select: {
        id: true,
        email: true,
        username: true,
        role: true,
        plan: true,
        publicKey: true,
        twoFactorEnabled: true,
        tokenVersion: true,
      },
      });
      return created;
    }).catch((err) => {
      if (err?.code === 'P2002') return null;
      throw err;
    });

    if (!user) {
      return res.status(409).json({
        error: 'Username or email already in use',
      });
    }

    await prisma.verificationToken.updateMany({
      where: { userId: user.id, type: 'email', usedAt: null },
      data: { usedAt: new Date() },
    });

    const raw = newRawToken();
    const tokenHash = await hashToken(raw);
    const expiresAt = new Date(Date.now() + 1000 * 60 * 60 * 24);

    await prisma.verificationToken.create({
      data: {
        userId: user.id,
        type: 'email',
        tokenHash,
        expiresAt,
      },
    });

    const base =
      process.env.FRONTEND_BASE_URL ||
      process.env.PUBLIC_BASE_URL ||
      process.env.APP_URL ||
      'http://localhost:5173';

    const link = `${base.replace(/\/+$/, '')}/verify-email?token=${encodeURIComponent(raw)}&uid=${user.id}`;

    try {
      const mailResult = await sendMail({
        to: user.email,
        from: process.env.EMAIL_FROM || 'Chatforia <hello@chatforia.com>',
        subject: 'Verify your Chatforia email',
        html: `
          <p>Welcome to Chatforia.</p>
          <p>Click below to verify your email:</p>
          <p><a href="${link}">Verify Email</a></p>
        `,
        text: `Verify your Chatforia email:\n${link}`,
      });

    } catch (err) {
      console.error('register sendMail error', err);
    }

    // Issue session immediately on register (you can also require email verify first)
    return res.status(201).json({
      message: 'user registered',
      requiresEmailVerification: true,
      user: {
        id: user.id,
        email: user.email,
        username: user.username,
        publicKey: user.publicKey,
        plan: user.plan,
        role: user.role,
      },
      privateKey,
    });
  })
);

/* =========================
 *         VERIFY
 * ========================= */

  const handleEmailVerify = asyncHandler(async (req, res) => {
  const { token, uid } = req.query || {};
  const userId = typeof uid === 'string' && /^\d+$/.test(uid) ? Number(uid) : NaN;
  if (typeof token !== 'string' || !token || token.length > 1024 ||
      !Number.isSafeInteger(userId) || userId <= 0 || userId > 2147483647) {
    return res.status(400).json({ ok: false, error: 'invalid_or_expired' });
  }

  const tokenHash = await hashToken(token);
  if (!await consumeEmailVerification(userId, tokenHash)) {
    return res.status(400).json({ ok: false, error: 'invalid_or_expired' });
  }
  return res.json({ ok: true });
});

  router.get('/email/verify', handleEmailVerify);
  // router.get('/verify-email', handleEmailVerify);

/* =========================
 *         LOGIN
 * ========================= */
router.post(
  '/login',
  asyncHandler(async (req, res) => {
    const { identifier, email, username, password } = req.body || {};
    const raw = (identifier || email || username || '').toString().trim();

    if (!raw || !password) {
      return res.status(400).json({ error: 'Missing credentials' });
    }

    // Lazy-load phone normalizer; route stays resilient if helper missing.
    let normalizePhone = null;
    try {
      normalizePhone = (await import('../utils/phoneNormalize.js')).default;
    } catch {
      normalizePhone = null;
    }

    try {
      let user = null;

      // Case-insensitive identity lookup must match exactly one active account.
      const firstField = raw.includes('@') ? 'email' : 'username';
      const secondField = firstField === 'email' ? 'username' : 'email';
      user = await findUniqueLoginIdentity(firstField, raw);
      if (!user) user = await findUniqueLoginIdentity(secondField, raw);

      // If still not found and we have a phone normalizer, try phone lookup.
      if (!user && normalizePhone) {
        try {
          const normalized = normalizePhone(raw);
          if (normalized) {
            user =
              (await prisma.user.findFirst({
                where: { phoneNumber: { equals: normalized } },
              })) ||
              null;
          }
        } catch {
          // ignore phone parse errors and continue
        }
      }

      if (!user || user.isBanned || user.deletedAt) {
        return res.status(401).json({ error: 'Invalid credentials' });
      }

      // Login must never assign a password to an existing account.
      // OAuth-only accounts must use their provider or password reset.
      const hash = user.passwordHash;

      if (typeof hash !== 'string' || !hash || hash === 'oauth') {
        return res.status(401).json({ error: 'Invalid credentials' });
      }

      // Verify password
      let ok = false;
      try {
        ok = await bcrypt.compare(password, hash);
      } catch {}


      if (!ok) {
        return res.status(401).json({ error: 'Invalid credentials' });
      }

      // Block login until verified
      if (!user.emailVerifiedAt) {
        return res.status(403).json({
          error: 'email_not_verified',
          message: 'Please verify your email.',
          canResendVerification: true,
          userId: user.id,
        });
      }

      // 2FA: if enabled, do not issue full session yet
      if (user.twoFactorEnabled) {
        const mfaToken = await createMfaChallenge(user);
        return res.json({
          mfaRequired: true,
          mfaToken,
          user: {
            id: user.id,
            email: user.email,
            username: user.username,
            role: user.role ?? 'USER',
            plan: user.plan ?? 'FREE',
          },
        });
      }

      // Normal session issuance
      const token = issueSession(res, user);

      return res.json({
        message: 'logged in',
        token,
        user: serializeUser(user),
      });
    } catch (e) {
      if (e?.code === 'ambiguous_login_identity') {
        return res.status(401).json({ error: 'Invalid credentials' });
      }
      throw e;
    }
  })
);

/* =========================
 *   MFA LOGIN STEP
 *   POST /auth/2fa/login { mfaToken, code }
 * ========================= */
router.get('/2fa/challenge.css', (_req, res) => {
  res.type('text/css').send(MFA_BROWSER_CSS);
});

router.get('/2fa/challenge.js', (_req, res) => {
  res.set('Cache-Control', 'no-store');
  res.type('application/javascript').send(MFA_BROWSER_SCRIPT);
});

router.get('/2fa/challenge', (req, res) => {
  res.set('Cache-Control', 'no-store');
  const token = req.cookies?.[pendingCookieName(req)];
  if (typeof token !== 'string' || token.length > 4096) {
    return res.status(401).send('Sign-in expired. Please start again.');
  }
  return res.type('html').send(renderMfaPage(token));
});

router.post(
  '/2fa/login',
  asyncHandler(async (req, res) => {
    res.set('Cache-Control', 'no-store');
    const { mfaToken, code, browserMfa } = req.body || {};
    if (typeof mfaToken !== 'string' || typeof code !== 'string' || !code.trim()) {
      return res.status(400).json({ ok: false, error: 'Missing fields' });
    }
    if (browserMfa === true && req.cookies?.[pendingCookieName(req)] !== mfaToken) {
      return res.status(401).json({ ok: false, error: 'Invalid MFA browser' });
    }
    const result = await completeMfaChallenge(mfaToken, code);
    if (!result.ok) return res.status(result.status).json({ ok: false, error: result.error });
    const token = issueSession(res, result.user, { mfaVerified: true });
    let redirectUrl;
    if (browserMfa === true) {
      res.clearCookie(pendingCookieName(req), pendingCookieOptions(req));
      redirectUrl = result.nextUrl;
      if (redirectUrl?.startsWith('chatforia://oauth/apple')) {
        const url = new URL(redirectUrl);
        url.searchParams.set('token', token);
        redirectUrl = url.toString();
      }
    }
    return res.json({ ok: true, message: 'logged in', token,
      user: serializeUser(result.user), ...(redirectUrl ? { redirectUrl } : {}) });
  })
);

/* =========================
 *   Short-lived API token
 * ========================= */
router.get(
  '/token',
  requireAuth,
  asyncHandler(async (req, res) => {
    const payload = {
      id: req.user.id,
      email: req.user.email,
      username: req.user.username,
      role: req.user.role,
      plan: req.user.plan,
      tokenVersion: req.user.tokenVersion ?? 0,
      typ: 'short',
    };

    const token = jwt.sign(payload, JWT_SECRET, { expiresIn: '10m' });
    res.json({ token });
  })
);

/* =========================
 *   FORGOT / RESET PASSWORD
 * ========================= */
router.post(
  '/forgot-password',
  asyncHandler(async (req, res) => {
    try {
      const { identifier, email, phone } = req.body || {};
      const raw = (identifier || email || phone || '').toString().trim();
      if (!raw) return res.status(400).json({ error: 'Email or phone is required' });

      let normalizePhone = null;
      try {
        normalizePhone = (await import('../utils/phoneNormalize.js')).default;
      } catch {
        normalizePhone = null;
      }

      let user = null;

      // Use the same unambiguous, active-account lookup as password login.
      if (raw.includes('@')) {
        user = await findUniqueLoginIdentity('email', raw);
      } else {
        user = await findUniqueLoginIdentity('username', raw);
      }
      if (!user && normalizePhone) {
        let normalized = null;
        try { normalized = normalizePhone(raw); } catch {}
        if (normalized) {
          const matches = await prisma.user.findMany({
            where: { phoneNumber: normalized, deletedAt: null },
            take: 2,
          });
          if (matches.length === 1) user = matches[0];
        }
      }

      if (!user || user.isBanned || user.deletedAt || !user.email) {
        return res.json({ message: 'If the email exists, a reset link will be sent' });
      }

      // 6) Issue reset token and assemble reset link
      const token = await issueResetToken(user.id);
      const base = process.env.FRONTEND_BASE_URL || 'http://localhost:5173';
      const resetLink = `${base.replace(/\/+$/, '')}/reset-password?token=${token}`;

      // 7) If user has an email, send reset link by email
      if (user.email) {
        try {
          await sendMail({
            to: user.email,
            subject: 'Reset Your Chatforia Password',
            html: `
              <p>Hello ${user.username || 'there'},</p>
              <p>Click the link below to reset your password:</p>
              <p><a href="${resetLink}">Reset Password</a></p>
            `,
            text: `Hello ${user.username || 'there'},\n\nReset your password:\n${resetLink}`,
            from: process.env.EMAIL_FROM || 'Chatforia <hello@chatforia.com>',
          });

          return res.json({
            message: 'If the email exists, a reset link will be sent',
            ...(IS_TEST ? { token } : {}),
          });
        } catch {
          return res.json({
            message: 'If the email exists, a reset link will be sent',
            ...(IS_TEST ? { token } : {}),
          });
        }
      }

      // 8) If found user but no email on file, return generic response.
      return res.json({
        message: 'If the email exists, a reset link will be sent',
        ...(IS_TEST ? { token } : {}),
      });
    } catch {
      return res.json({
        message: 'If the email exists, a reset link will be sent',
        ...(IS_TEST ? { token: 'noop' } : {}),
      });
    }
  })
);

router.post(
  '/reset-password',
  asyncHandler(async (req, res) => {
    const { token, newPassword } = req.body || {};
    if (!token || typeof newPassword !== 'string' || newPassword.length < 8) {
      return res.status(400).json({ error: 'Invalid request' });
    }

    if (typeof token !== 'string' || !/^[a-f0-9]{64}$/.test(token)) {
      return res.status(400).json({ error: 'Invalid or expired token' });
    }
    const hashed = await bcrypt.hash(newPassword, 10);
    const changed = await prisma.$transaction(async (tx) => {
      const userId = await consumeResetToken(token, tx);
      if (!userId) return false;
      await tx.user.update({
        where: { id: userId },
        data: { passwordHash: hashed, tokenVersion: { increment: 1 } },
      });
      await tx.passwordResetToken.updateMany({
        where: { userId, usedAt: null },
        data: { usedAt: new Date() },
      });
      return true;
    });
    if (!changed) return res.status(400).json({ error: 'Invalid or expired token' });

    return res.json({ ok: true });
  })
);

/* =========================
 *   SMS consent + OTP flow
 *   POST /auth/send-verify
 *   POST /auth/verify-phone-code
 * ========================= */

const otpLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 12,
  message: { message: 'Too many requests from this IP, try again later.' },
});

const otpVerifyLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 60,
  message: { message: 'Too many verification attempts from this IP, try again later.' },
});

function isE164Simple(phone) {
  return typeof phone === 'string' && /^\+\d{7,15}$/.test(phone.trim());
}

router.post(
  '/send-verify',
  otpLimiter,
  body('phone').isString(),
  body('consent').exists(),
  asyncHandler(async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(422).json({ errors: errors.array() });

    const rawPhone = String(req.body.phone || '').trim();
    const consent = req.body.consent === true || req.body.consent === 'true';

    if (!consent) return res.status(400).json({ message: 'Consent is required' });
    if (!isE164Simple(rawPhone)) {
      return res
        .status(422)
        .json({ message: 'Phone must be in E.164 format (e.g. +14155551234)' });
    }

    const phone = normalizeE164(rawPhone);

    const issued = await createPhoneVerification({
      phone,
      consentTextVersion: process.env.SMS_CONSENT_VERSION || 'v1',
      ipAddress: req.ip,
      userAgent: req.get('user-agent') || null,
    });
    if (issued.status !== 200) return res.status(issued.status).json({ message: issued.message });
    const otp = issued.code;

    const text = `Chatforia: Your verification code is ${otp}. Msg & data rates may apply. Reply STOP to opt out, HELP for help.`;
    try {
      const sendResult = await sendSms({
        to: phone,
        text,
        clientRef: `otp:${phone}:${Date.now()}`,
      });

      if (sendResult?.messageSid) {
        await prisma.phoneOtp.updateMany({
          where: { id: issued.id },
          data: { providerMessageId: sendResult.messageSid },
        });
      }

      return res.json({ message: 'Verification code sent' });
    } catch (err) {
      await prisma.phoneOtp.updateMany({ where: { id: issued.id }, data: { expiresAt: new Date() } });
      console.error('send-verify sendSms error', err);
      return res.status(500).json({ message: 'Failed to send verification code' });
    }
  })
);

router.post(
  '/verify-phone-code',
  otpVerifyLimiter,
  body('phone').isString(),
  body('code').isString(),
  asyncHandler(async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(422).json({ errors: errors.array() });
    const rawPhone = req.body.phone.trim();
    const code = req.body.code.trim();
    if (!isE164Simple(rawPhone) || !/^\d{6}$/.test(code)) {
      return res.status(422).json({ message: 'Invalid input' });
    }
    const result = await consumePhoneVerification(normalizeE164(rawPhone), code);
    const { status, ...payload } = result;
    return res.status(status).json(payload);
  })
);

/* =========================
 *         RESEND EMAIL
 *   POST /auth/resend-email  { email }
 * ========================= */

const resendLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 6,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'too_many_requests' },
});

router.post(
  '/resend-email',
  resendLimiter,
  asyncHandler(async (req, res) => {
    try {
      const { email } = req.body || {};
      if (!email || typeof email !== 'string') {
        return res.status(200).json({ ok: true });
      }

      const normalized = email.trim().toLowerCase();
      const user = await findUniqueLoginIdentity('email', normalized);

      if (!user || user.isBanned || user.deletedAt) {
        return res.status(200).json({ ok: true });
      }

      if (user.emailVerifiedAt) {
        return res.status(200).json({ ok: true });
      }

      const recent = await prisma.verificationToken.findFirst({
        where: { userId: user.id, type: 'email' },
        orderBy: { createdAt: 'desc' },
      });
      if (recent && (new Date() - new Date(recent.createdAt)) < 60 * 60 * 1000) {
        return res.status(200).json({ ok: true });
      }

      await prisma.verificationToken.updateMany({
        where: { userId: user.id, type: 'email', usedAt: null },
        data: { usedAt: new Date() },
      });

      const raw = newRawToken();
      const tokenHash = await hashToken(raw);
      const expiresAt = new Date(Date.now() + 1000 * 60 * 60 * 24);

      await prisma.verificationToken.create({
        data: {
          userId: user.id,
          type: 'email',
          tokenHash,
          expiresAt,
        },
      });

      const base =
        process.env.FRONTEND_BASE_URL ||
        process.env.PUBLIC_BASE_URL ||
        process.env.APP_URL ||
        'http://localhost:5173';

      const link = `${base.replace(/\/+$/, '')}/verify-email?token=${encodeURIComponent(raw)}&uid=${user.id}`;

      try {
        const mailResult = await sendMail({
          to: user.email,
          from: process.env.EMAIL_FROM || 'Chatforia <hello@chatforia.com>',
          subject: 'Verify your Chatforia email',
          html: `
            <p>Welcome to Chatforia.</p>
            <p>Click below to verify your email:</p>
            <p><a href="${link}">Verify Email</a></p>
          `,
          text: `Verify your Chatforia email:\n${link}`,
        });

      } catch (err) {
        console.error('resend-email sendMail error', err);
      }

      return res.status(200).json({ ok: true });
    } catch (err) {
      console.error('resend-email error', err);
      return res.status(200).json({ ok: true });
    }
  })
);

/* =========================
 *         LOGOUT
 * ========================= */
router.post(
  '/logout',
  asyncHandler(async (req, res) => {
    clearAllAuthCookies(res);

    if (req.logout) {
      try {
        await new Promise((resolve, reject) =>
          req.logout((err) => (err ? reject(err) : resolve()))
        );
      } catch {
        // ignore
      }
    }

    if (req.session) {
      req.session.destroy(() => {});
    }

    res.json({ ok: true });
  })
);

router.get('/logout', (req, res) => {
  clearAllAuthCookies(res);

  if (req.session) {
    req.session.destroy(() => {});
  }

  const next =
    req.query.next || 'https://www.chatforia.com/';

  return res.redirect(next);
});

/* =========================
 *   KEY BACKUP SAVE
 *   POST /auth/keys/backup
 * ========================= */
router.post(
  '/keys/backup',
  requireAuth,
  asyncHandler(async (req, res) => {
    const userId = Number(req.user?.id);

    const {
      publicKey,
      encryptedPrivateKeyBundle,
      privateKeyWrapSalt,
      privateKeyWrapKdf,
      privateKeyWrapIterations,
      privateKeyWrapVersion,
    } = req.body || {};

    if (!publicKey || typeof publicKey !== 'string' || publicKey.length < 24) {
      return res.status(400).json({ error: 'publicKey is required' });
    }

    if (
      !encryptedPrivateKeyBundle ||
      typeof encryptedPrivateKeyBundle !== 'string' ||
      encryptedPrivateKeyBundle.length < 32
    ) {
      return res.status(400).json({ error: 'encryptedPrivateKeyBundle is required' });
    }

    if (!privateKeyWrapSalt || typeof privateKeyWrapSalt !== 'string') {
      return res.status(400).json({ error: 'privateKeyWrapSalt is required' });
    }

    if (privateKeyWrapKdf !== 'PBKDF2-SHA256') {
      return res.status(400).json({ error: 'Unsupported privateKeyWrapKdf' });
    }

    const iterations = Number(privateKeyWrapIterations);
    if (!Number.isFinite(iterations) || iterations < 100000) {
      return res.status(400).json({ error: 'privateKeyWrapIterations is invalid' });
    }

    const version = Number(privateKeyWrapVersion || 1);
    if (![1].includes(version)) {
      return res.status(400).json({ error: 'Unsupported privateKeyWrapVersion' });
    }

    const updated = await prisma.user.update({
      where: { id: userId },
      data: {
        publicKey,
        encryptedPrivateKeyBundle,
        privateKeyWrapSalt,
        privateKeyWrapKdf,
        privateKeyWrapIterations: iterations,
        privateKeyWrapVersion: version,
      },
      select: {
        id: true,
        publicKey: true,
        encryptedPrivateKeyBundle: true,
        privateKeyWrapSalt: true,
        privateKeyWrapKdf: true,
        privateKeyWrapIterations: true,
        privateKeyWrapVersion: true,
      },
    });

    return res.json({
      ok: true,
      hasBackup: true,
      keys: pickKeyBackupFields(updated),
      backupUpdatedAt: null,
    });
  })
);

/* =========================
 *   KEY BACKUP FETCH
 *   GET /
 * ========================= */
router.get(
  '/keys/backup',
  requireAuth,
  asyncHandler(async (req, res) => {
    const userId = Number(req.user?.id);

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        email: true,
        emailVerifiedAt: true,
        publicKey: true,
        encryptedPrivateKeyBundle: true,
        privateKeyWrapSalt: true,
        privateKeyWrapKdf: true,
        privateKeyWrapIterations: true,
        privateKeyWrapVersion: true,
      },
    });

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const hasBackup =
      !!user.encryptedPrivateKeyBundle &&
      !!user.privateKeyWrapSalt &&
      !!user.privateKeyWrapKdf &&
      Number.isFinite(user.privateKeyWrapIterations);

    return res.json({
      ok: true,
      hasBackup,
      keys: hasBackup ? pickKeyBackupFields(user) : null,
      backupUpdatedAt: null,
    });
  })
);

/* =========================
 *   KEY BACKUP FETCH
 *   DELETE /auth/keys/backup
 * ========================= */

router.delete(
  '/keys/backup',
  requireAuth,
  asyncHandler(async (req, res) => {
    const userId = Number(req.user?.id);

    await prisma.user.update({
      where: { id: userId },
      data: {
        encryptedPrivateKeyBundle: null,
        privateKeyWrapSalt: null,
        privateKeyWrapKdf: null,
        privateKeyWrapIterations: null,
        privateKeyWrapVersion: 1,
      },
    });

    return res.json({
      ok: true,
      hasBackup: false,
      keys: null,
    });
  })
);

/* =========================
 *   KEY BACKUP FETCH
 *   ROTATE/auth/keys/backup
 * ========================= */
router.post(
  '/keys/rotate',
  requireAuth,
  asyncHandler(async (req, res) => {
    try {
      const userId = Number(req.user?.id);
      const { publicKey, invalidateExistingBackup = true } = req.body || {};

      if (!publicKey || typeof publicKey !== 'string' || publicKey.length < 24) {
        return res.status(400).json({ error: 'publicKey is required' });
      }

      const data = {
        publicKey,
      };

      if (invalidateExistingBackup) {
        data.encryptedPrivateKeyBundle = null;
        data.privateKeyWrapSalt = null;
        data.privateKeyWrapKdf = null;
        data.privateKeyWrapIterations = null;
        data.privateKeyWrapVersion = 1;
      }

      const updated = await prisma.user.update({
        where: { id: userId },
        data,
        select: {
          publicKey: true,
          encryptedPrivateKeyBundle: true,
        },
      });

      return res.json({
        ok: true,
        publicKey: updated.publicKey,
        hasBackup: !!updated.encryptedPrivateKeyBundle,
      });
    } catch (err) {
      console.error('[keys/rotate] FAILED', {
        message: err?.message,
        stack: err?.stack,
        code: err?.code,
        meta: err?.meta,
        name: err?.name,
      });
      throw err;
    }
  })
);

router.post(
  '/account/encryption/reset',
  requireAuth,
  asyncHandler(async (req, res) => {
    const userId = Number(req.user?.id);
    const { publicKey, invalidateExistingBackup = true } = req.body || {};

    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    if (!publicKey || typeof publicKey !== 'string' || publicKey.length < 24) {
      return res.status(400).json({ error: 'publicKey is required' });
    }

    const data = {
      publicKey,
    };

    if (invalidateExistingBackup) {
      data.encryptedPrivateKeyBundle = null;
      data.privateKeyWrapSalt = null;
      data.privateKeyWrapKdf = null;
      data.privateKeyWrapIterations = null;
      data.privateKeyWrapVersion = 1;
    }

    const updated = await prisma.user.update({
      where: { id: userId },
      data,
      select: {
        id: true,
        email: true,
        username: true,
        publicKey: true,
        encryptedPrivateKeyBundle: true,
      },
    });

    return res.json({
      ok: true,
      user: {
        id: updated.id,
        email: updated.email,
        username: updated.username,
        publicKey: updated.publicKey,
      },
      hasBackup: !!updated.encryptedPrivateKeyBundle,
      warning:
        'Encryption key reset. Older encrypted messages may not be readable without your previous key.',
    });
  })
);

const FREE_THEMES = ['dawn', 'midnight'];
const PREMIUM_THEMES = ['amoled', 'aurora', 'neon', 'sunset', 'solarized', 'velvet'];

const FREE_MESSAGE_TONES = ['Default.mp3', 'Vibrate.mp3'];
const FREE_RINGTONES = ['Classic.mp3', 'Urgency.mp3'];

const ALL_MESSAGE_TONES = [
  'Default.mp3',
  'Dreamer.mp3',
  'Happy Message.mp3',
  'Notify.mp3',
  'Pop.mp3',
  'Pulsating Sound.mp3',
  'Text Message.mp3',
  'Vibrate.mp3',
  'Xylophone.mp3',
];

const ALL_RINGTONES = [
  'Bells.mp3',
  'Classic.mp3',
  'Chimes.mp3',
  'Digital Phone.mp3',
  'Melodic.mp3',
  'Organ Notes.mp3',
  'Sound Reality.mp3',
  'Street.mp3',
  'Universfield.mp3',
  'Urgency.mp3',
];

const PREMIUM_MESSAGE_TONES = ALL_MESSAGE_TONES.filter(
  (x) => !FREE_MESSAGE_TONES.includes(x)
);

const PREMIUM_RINGTONES = ALL_RINGTONES.filter(
  (x) => !FREE_RINGTONES.includes(x)
);

function hasPaidAccess(user) {
  if (!user) return false;
  if (user.role === 'ADMIN') return true;

  const active =
    user.subscriptionStatus === 'ACTIVE' &&
    (!user.subscriptionEndsAt || new Date(user.subscriptionEndsAt) > new Date());

  if (!active) return false;

  return ['PLUS', 'PREMIUM', 'WIRELESS'].includes(String(user.plan || '').toUpperCase());
}

function sanitizeEntitledSettings(user) {
  const safe = { ...user };
  const paid = hasPaidAccess(safe);

  if (!paid && !FREE_THEMES.includes(safe.theme)) {
    safe.theme = 'dawn';
  }

  if (!paid && PREMIUM_MESSAGE_TONES.includes(safe.messageTone)) {
    safe.messageTone = 'Default.mp3';
  }

  if (!paid && PREMIUM_RINGTONES.includes(safe.ringtone)) {
    safe.ringtone = 'Classic.mp3';
  }

  return safe;
}

/* =========================
 *         ME
 * ========================= */
router.get(
  '/me',
  requireAuth,
  asyncHandler(async (req, res) => {
    res.set('Cache-Control', 'no-store');

    const fullUser = await prisma.user.findUnique({
      where: { id: Number(req.user.id) },
    });

    if (!fullUser) {
      return res.status(404).json({ error: 'User not found' });
    }

    const safeUser = sanitizeEntitledSettings(fullUser);
    const paid = hasPaidAccess(safeUser);

    const userPayload = {
      id: safeUser.id,
      email: safeUser.email,
      username: safeUser.username,
      publicKey: safeUser.publicKey,
      role: safeUser.role,
      plan: safeUser.plan,
      isPremium: paid,

      preferredLanguage: safeUser.preferredLanguage,
      uiLanguage: safeUser.uiLanguage,
      theme: safeUser.theme || 'dawn',
      avatarUrl: safeUser.avatarUrl,

      autoTranslate: safeUser.autoTranslate,
      showOriginalWithTranslation: safeUser.showOriginalWithTranslation,
      allowExplicitContent: safeUser.allowExplicitContent,
      showReadReceipts: safeUser.showReadReceipts,
      autoDeleteSeconds: safeUser.autoDeleteSeconds,

      privacyBlurEnabled: safeUser.privacyBlurEnabled,
      privacyBlurOnUnfocus: safeUser.privacyBlurOnUnfocus,
      privacyHoldToReveal: safeUser.privacyHoldToReveal,
      notifyOnCopy: safeUser.notifyOnCopy,

      ageBand: safeUser.ageBand,
      wantsAgeFilter: safeUser.wantsAgeFilter,
      randomChatAllowedBands: safeUser.randomChatAllowedBands,

      riaRemember: safeUser.riaRemember,

      voicemailEnabled: safeUser.voicemailEnabled,
      voicemailAutoDeleteDays: safeUser.voicemailAutoDeleteDays,
      voicemailForwardEmail: safeUser.voicemailForwardEmail,
      voicemailEmailForwardingEnabled: safeUser.voicemailEmailForwardingEnabled ?? false,
      canForwardVoicemailEmail: canForwardVoicemailEmail(safeUser),
      voicemailGreetingText: safeUser.voicemailGreetingText,
      voicemailGreetingUrl: safeUser.voicemailGreetingUrl,

      messageTone: safeUser.messageTone || 'Default.mp3',
      ringtone: safeUser.ringtone || 'Classic.mp3',
      soundVolume: safeUser.soundVolume ?? 70,

      enableSmartReplies: safeUser.enableSmartReplies ?? false,
    };
    let subscriber = null;
    try {
      subscriber = await prisma.subscriber.findFirst({
        where: { userId: Number(req.user.id) },
        select: {
          id: true,
          provider: true,
          status: true,
          iccid: true,
          iccidHint: true,
          providerProfileId: true,
          msisdn: true,
          smdp: true,
          activationCode: true,
          lpaUri: true,
          qrPayload: true,

          providerMeta: true,
          createdAt: true,
          updatedAt: true,
        },
      });
    } catch (e) {
      console.warn('auth/me: subscriber lookup failed', e);
    }

    return res.json({
      user: userPayload,
      entitlements: {
        canUsePremiumThemes: paid,
        canUsePremiumMessageTones: paid,
        canUsePremiumRingtones: paid,
      },
      subscriber,
    });
  })
);

export { setJwtCookie, clearAllAuthCookies };
export default router;
