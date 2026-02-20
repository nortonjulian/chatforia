import express from 'express';
import prisma from '../utils/prismaClient.js';
import { sendSms } from '../services/twilio.js';

const router = express.Router();

router.post('/request-phone-verification', async (req, res) => {
  const { phoneNumber, intent } = req.body;
  if (!phoneNumber) return res.status(400).json({ error: 'phoneNumber required' });

  const code = Math.floor(100000 + Math.random() * 900000).toString();
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

  const record = await prisma.phoneVerificationRequest.create({
    data: {
      phoneNumber,
      verificationCode: code,
      expiresAt,
      consentedAt: new Date(),
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
      intent: intent || 'registration',
      phoneVerificationId: crypto.randomUUID().slice(0, 12), // short token
    },
  });

  // send SMS (wrap sendSms to check opt-out upstream if you prefer)
  await sendSms({
    to: phoneNumber,
    body: `Chatforia: Your verification code is ${code}. Reply STOP to opt out.`,
  });

  return res.json({ verificationRequestId: record.id, phoneVerificationId: record.phoneVerificationId });
});

export default router;
