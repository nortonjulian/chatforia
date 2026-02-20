import express from 'express';
import prisma from '../utils/prismaClient.js';

const router = express.Router();

router.post('/verify-phone-code', async (req, res) => {
  const { verificationRequestId, code } = req.body;
  if (!verificationRequestId || !code) return res.status(400).json({ error: 'missing args' });

  const reqRec = await prisma.phoneVerificationRequest.findFirst({
  where: {
    phoneVerificationId: String(verificationRequestId),
    consumedAt: null,
  },
  orderBy: { createdAt: 'desc' },
});

if (!reqRec)
  return res.status(400).json({ error: 'invalid_or_consumed_token' });


  if (!reqRec) return res.status(404).json({ error: 'not found' });
  if (reqRec.verifiedAt) return res.status(409).json({ error: 'already verified' });
  if (reqRec.expiresAt < new Date()) return res.status(410).json({ error: 'expired' });
  if (reqRec.verificationCode !== code) return res.status(400).json({ error: 'invalid code' });

  await prisma.phoneVerificationRequest.update({
  where: { id: reqRec.id },
  data: {
    verifiedAt: new Date(),
    consumedAt: new Date(), // 🔴 prevents reuse
  }
});

  // Optionally create or upsert Phone row and set verifiedAt
  const phone = await prisma.phone.upsert({
    where: { number: reqRec.phoneNumber },
    create: { number: reqRec.phoneNumber, verifiedAt: new Date() },
    update: { verifiedAt: new Date() }
  });

  return res.json({ phoneVerificationId: reqRec.phoneVerificationId, phoneId: phone.id });
});
export default router;
