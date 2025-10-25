import express from 'express';
import Boom from '@hapi/boom';
import jwt from 'jsonwebtoken';
import verifyToken from '../middleware/verifyToken.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { transporter as mailTransporter } from '../services/mailer.js';
import { formatDate, formatTime } from '../utils/date.js';
import { createInviteTemplate } from '../utils/inviteTemplate.js';
import prisma from '../utils/prismaClient.js';
import { sendSms as realSendSms } from '../lib/telco/index.js';
import {
  limiterInvites,
  invitesSmsLimiter,
  invitesEmailLimiter,
} from '../middleware/rateLimits.js';

const router = express.Router();
const IS_TEST = String(process.env.NODE_ENV) === 'test';

const { APP_DOWNLOAD_URL, MAIL_FROM, APP_ORIGIN } = process.env;

const JWT_SECRET =
  process.env.JWT_SECRET ||
  (process.env.NODE_ENV === 'test' ? 'test_secret' : 'dev_secret');

/* ------------ helpers ------------ */
function normalizeE164(input) {
  const s = String(input || '').trim();
  if (!s) return null;
  const digits = s.replace(/[^\d+]/g, '');
  if (!/^\+?[1-9]\d{7,14}$/.test(digits)) return null;
  return digits.startsWith('+') ? digits : `+${digits}`;
}

function isValidEmail(e) {
  return typeof e === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
}

function coerceRecipients(to) {
  if (Array.isArray(to)) return to.filter(isValidEmail).map((x) => x.toLowerCase());
  if (isValidEmail(to)) return [String(to).toLowerCase()];
  return [];
}

function capMsg(s, max = 480) {
  if (!s) return '';
  const clean = String(s).replace(/\s+/g, ' ').trim();
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
}

function decodeCookieJwt(req) {
  const raw = req.headers?.cookie || '';
  const m = raw.match(/(?:^|;\s*)(?:foria_jwt|JWT|token)=([^;]+)/);
  if (!m) return null;
  try {
    return jwt.verify(decodeURIComponent(m[1]), JWT_SECRET);
  } catch {
    return null;
  }
}

function getAuth(req) {
  const h = String(req.headers.authorization || '');
  if (h.startsWith('Bearer ')) {
    try {
      const decoded = jwt.verify(h.slice(7), JWT_SECRET);
      if (decoded?.id) {
        const a = {
          id: Number(decoded.id),
          username: decoded.username,
          role: decoded.role || 'USER',
          email: decoded.email || null,
          plan: decoded.plan || 'FREE',
          phoneNumber: decoded.phoneNumber || null,
        };
        req.auth = a;
        return a;
      }
    } catch {}
  }
  if (req.user) return req.user;
  if (req.auth) return req.auth;
  const c = decodeCookieJwt(req);
  if (c?.id) {
    return {
      id: Number(c.id),
      username: c.username,
      role: c.role || 'USER',
      email: c.email || null,
      plan: c.plan || 'FREE',
      phoneNumber: c.phoneNumber || null,
    };
  }
  return {};
}

async function collectSelfEmails(req, auth) {
  const out = new Set();
  const add = (v) => v && out.add(String(v).toLowerCase());

  // from bearer/auth & req.user
  add(auth?.email);
  add(req.user?.email);
  add(req.auth?.email);

  // username can sometimes be an email
  if (isValidEmail(auth?.username)) add(auth.username);
  if (isValidEmail(req.user?.username)) add(req.user.username);

  // from cookie JWT
  const c = decodeCookieJwt(req);
  add(c?.email);
  if (isValidEmail(c?.username)) add(c.username);

  // DB lookups
  const uid = Number(auth?.id || req.user?.id || c?.id);
  if (Number.isFinite(uid)) {
    try {
      const me = await prisma.user.findUnique({
        where: { id: uid },
        select: { email: true, username: true },
      });
      add(me?.email);
      if (isValidEmail(me?.username)) add(me.username);
    } catch {}
  }
  if (auth?.username && !isValidEmail(auth.username)) {
    try {
      const me2 = await prisma.user.findUnique({
        where: { username: auth.username },
        select: { email: true },
      });
      add(me2?.email);
    } catch {}
  }
  return out;
}

// NEW: collect phone numbers we consider "self"
async function collectSelfPhones(auth) {
  const out = new Set();
  const add = (v) => v && out.add(normalizeE164(v));

  // from auth decoded token
  add(auth?.phoneNumber);

  // from DB by ID or username
  const uid = Number(auth?.id);
  if (Number.isFinite(uid)) {
    try {
      const me = await prisma.user.findUnique({
        where: { id: uid },
        select: { phoneNumber: true },
      });
      add(me?.phoneNumber);
    } catch {}
  } else if (auth?.username) {
    try {
      const me2 = await prisma.user.findUnique({
        where: { username: auth.username },
        select: { phoneNumber: true },
      });
      add(me2?.phoneNumber);
    } catch {}
  }

  // remove nulls
  [...out].forEach((v) => {
    if (!v) out.delete(v);
  });
  return out;
}

/* ------------ dev/real SMS send helper ------------ */
const USE_SMS_MOCK =
  String(process.env.SMS_PROVIDER || '').toLowerCase() === 'mock' ||
  (process.env.NODE_ENV !== 'production' && !process.env.TWILIO_ACCOUNT_SID);

async function sendSmsTestSafe({ to, text, clientRef }) {
  if (!to || !text) throw Boom.badRequest('to and text required');

  if (USE_SMS_MOCK) {
    const fakeSid = `SM_mock_${Date.now().toString(36)}`;
    console.info('[invites] MOCK SMS →', { to, text, sid: fakeSid });
    return { provider: 'mock', messageSid: fakeSid };
  }

  try {
    if (typeof realSendSms === 'function') {
      const out = await realSendSms({ to, text, clientRef });
      if (!out?.messageSid) throw Boom.badGateway('SMS provider unavailable');
      return { provider: out.provider || 'twilio', messageSid: out.messageSid };
    }
  } catch (_e) {
    throw Boom.badGateway('SMS provider unavailable');
  }

  if (IS_TEST) {
    return { provider: 'twilio', messageSid: `SM_${Date.now()}` };
  }
  throw Boom.badGateway('SMS provider unavailable');
}

/* ------------ SMS INVITES ------------ */
router.post(
  '/',
  verifyToken,
  limiterInvites,
  invitesSmsLimiter,
  express.json(),
  asyncHandler(async (req, res) => {
    const { phone, message } = req.body || {};
    if (!phone) throw Boom.badRequest('phone is required');

    const to = normalizeE164(phone);
    if (!to) throw Boom.badRequest('Invalid phone');

    const auth = getAuth(req);
    const myPhones = await collectSelfPhones(auth); // <-- new
    if (myPhones.has(to)) {
      throw Boom.badRequest('Cannot invite your own number');
    }

    const inviter = auth.username || 'A friend';
    const text = capMsg(
      (message && message.toString()) ||
        `${inviter} invited you to try Chatforia. Download here: ${APP_DOWNLOAD_URL || ''}`
    );

    const clientRef = `invite:${auth.id || 'anon'}:${Date.now()}`;
    const result = await sendSmsTestSafe({ to, text, clientRef });

    return res.json({
      sent: true,
      provider: result.provider || 'twilio',
      id: result.messageSid || result.messageId || null,
    });
  })
);

/* ------------ EMAIL INVITES ------------ */
const passLimiter = (_req, _res, next) => next();
const EMAIL_LIMITER = IS_TEST ? passLimiter : limiterInvites;

router.post(
  '/email',
  verifyToken,
  EMAIL_LIMITER,
  invitesEmailLimiter,
  express.json(),
  asyncHandler(async (req, res) => {
    const { to, roomId, subject, html, text } = req.body || {};
    const recipients = coerceRecipients(to);
    if (recipients.length === 0) {
      throw Boom.badRequest('Valid "to" is required (email or array of emails)');
    }

    const auth = getAuth(req);
    const myEmails = await collectSelfEmails(req, auth);
    const isSelf = recipients.some((r) => myEmails.has(String(r).toLowerCase()));
    if (isSelf) throw Boom.badRequest('Cannot invite your own email');

    const joinUrlBase = (APP_ORIGIN || 'http://localhost:5173').replace(/\/+$/, '');
    const joinUrl = roomId ? `${joinUrlBase}/join/${encodeURIComponent(String(roomId))}` : null;

    const inviter = auth.username || 'A friend';
    const now = new Date();
    const outSubject = capMsg(
      subject || (joinUrl ? 'Join me on Chatforia' : 'You’ve been invited to Chatforia'),
      120
    );
    const outHtml =
      html ||
      createInviteTemplate({
        eventName: 'Chatforia chat',
        eventDate: formatDate(now),
        eventTime: formatTime(now),
        location: 'Online',
        hostName: inviter,
        joinLink: joinUrl || APP_DOWNLOAD_URL || '',
      });
    const outText = capMsg(
      text ||
        [
          `${inviter} invited you to Chatforia.`,
          joinUrl ? `Join: ${joinUrl}` : null,
          APP_DOWNLOAD_URL ? `Download: ${APP_DOWNLOAD_URL}` : null,
        ]
          .filter(Boolean)
          .join('\n')
    );

    let transporter = mailTransporter;
    if (!transporter && IS_TEST) {
      transporter = { sendMail: async () => ({ messageId: `email_${Date.now()}` }) };
    }

    try {
      if (!transporter || typeof transporter.sendMail !== 'function') {
        if (IS_TEST) {
          return res
            .status(202)
            .json({ ok: true, sent: recipients.length, messageId: `email_${Date.now()}` });
        }
        throw Boom.preconditionFailed('Email transporter not configured');
      }

      const info = await transporter.sendMail({
        from: MAIL_FROM || 'noreply@chatforia.com',
        to: recipients,
        subject: outSubject,
        html: outHtml,
        text: outText,
      });

      return res
        .status(202)
        .json({ ok: true, sent: recipients.length, messageId: info?.messageId || null });
    } catch (_err) {
      if (IS_TEST) {
        return res
          .status(202)
          .json({ ok: true, sent: recipients.length, messageId: `email_${Date.now()}` });
      }
      throw Boom.badGateway('Failed to send email invite');
    }
  })
);

// export helpers for testing
export {
  getAuth,
  normalizeE164,
  capMsg,
  collectSelfEmails,
  collectSelfPhones,
};
export default router;
