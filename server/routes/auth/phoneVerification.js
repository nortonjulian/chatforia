import express from 'express';
import prisma from '../../utils/prismaClient.js';
import crypto from 'crypto';
import { getClientIp } from '../../utils/ip.js';
import { sendSms as twilioSendSms } from '../../lib/telco/index.js';
import { normalizeE164, isE164 } from '../../utils/phone.js';

const IS_TEST = String(process.env.NODE_ENV) === 'test';

export const router = express.Router();

function hash(s) { return crypto.createHash('sha256').update(s, 'utf8').digest('hex'); }
const CODE_TTL_MS = 10 * 60 * 1000;
const MAX_ATTEMPTS = 5;

// POST /auth/phone/start { phoneNumber }
router.post('/phone/start', async (req, res) => {
  const userId = req.user.id;
  const { phoneNumber } = req.body || {};
  const to = normalizeE164(phoneNumber);
  if (!isE164(to)) return res.status(400).json({ ok: false, reason: 'invalid_phone' });

  // Normalize/validate E.164, rate limit, reserve uniqueness if you require
  const code = (Math.floor(Math.random() * 900000) + 100000).toString(); // 6 digits
  const codeHash = hash(code);
  const expiresAt = new Date(Date.now() + CODE_TTL_MS);

  await prisma.verificationToken.deleteMany({ where: { userId, type: 'PHONE', usedAt: null } });
  await prisma.verificationToken.create({
    data: { userId, type: 'PHONE', tokenHash: codeHash, expiresAt },
  });

  // Save pending phone to user temp field or pass back; here we store immediately
  await prisma.user.update({ where: { id: userId }, data: { phoneNumber: to } });

  await sendVerificationSms(to, `Your Chatforia code is ${code}`);
  res.json({ ok: true });
});

// POST /auth/phone/verify { code }
router.post('/phone/verify', async (req, res) => {
  const userId = req.user.id;
  const { code } = req.body;
  const codeHash = hash(code);

  const token = await prisma.verificationToken.findFirst({
    where: { userId, type: 'PHONE', usedAt: null },
    orderBy: { createdAt: 'desc' },
  });
  if (!token || token.expiresAt < new Date()) return res.status(400).json({ ok: false, reason: 'expired' });

  // attempt counter (in-memory or DB). Minimal example:
  req.session.phoneAttempts = (req.session.phoneAttempts || 0) + 1;
  if (req.session.phoneAttempts > MAX_ATTEMPTS) return res.status(429).json({ ok: false, reason: 'too_many_attempts' });

  if (token.tokenHash !== codeHash) return res.status(400).json({ ok: false, reason: 'bad_code' });

  await prisma.$transaction([
    prisma.verificationToken.update({ where: { id: token.id }, data: { usedAt: new Date() } }),
    prisma.user.update({
      where: { id: userId },
      data: { phoneVerifiedAt: new Date(), phoneVerifiedIp: getClientIp(req) },
    }),
  ]);
  req.session.phoneAttempts = 0;
  res.json({ ok: true });
});

/**
 * Twilio-backed verification SMS sender.
 * In tests, do not hit the provider.
 */
async function sendVerificationSms(to, body) {
  if (IS_TEST) {
    // mimic Twilio response shape in test to keep logs & assertions simple
    return { provider: 'twilio', messageSid: `SM_${Date.now()}` };
  }
  // Guardrails: require minimal Twilio env; errors bubble up as 502s from the caller if unhandled
  const res = await twilioSendSms({
    to,
    text: String(body).slice(0, 800),
    clientRef: `verify:${Date.now()}`,
  });
  return res;
}
