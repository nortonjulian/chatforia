import express from 'express';
import prisma from '../utils/prismaClient.js';
import { sendSms } from '../lib/telco/index.js'; // uses sendSmsSafe if wired
import crypto from 'crypto';

const router = express.Router();

function randomCode() {
  return (Math.floor(Math.random() * 900000) + 100000).toString();
}

const TTL_MS = 10 * 60 * 1000; // 10m

// POST /sms-consent/start
router.post('/start', async (req, res) => {
  try {
    const phoneNumber = (req.body?.phoneNumber || '').trim();
    if (!phoneNumber || !phoneNumber.startsWith('+')) {
      return res.status(400).json({ ok: false, error: 'invalid_phone' });
    }

    // rate-limit + captcha recommended in production (not shown here)

    const code = randomCode();
    // generate a verification id for the front-end to reference (optional)
    const verificationRequestId = crypto.randomUUID();

    const expiresAt = new Date(Date.now() + TTL_MS);

    // create phoneVerificationRequest record (model already used by verify-phone-code)
    const rec = await prisma.phoneVerificationRequest.create({
      data: {
        phoneNumber,
        verificationCode: code,
        verificationRequestId: verificationRequestId,
        expiresAt,
      },
    });

    // send SMS (use your provider wrapper)
    await sendSms({
      to: phoneNumber,
      text: `Your Chatforia verification code is ${code}`,
      clientRef: `sms-consent:${rec.id}`,
    });

    return res.json({ ok: true, verificationRequestId: rec.id });
  } catch (err) {
    console.error('smsConsent/start error', err);
    return res.status(500).json({ ok: false, error: 'server_error' });
  }
});

export default router;