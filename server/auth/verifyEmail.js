import express from 'express';
import prisma from '../../utils/prismaClient.js';
import { newRawToken, hashToken, verifyHash } from '../../utils/tokens.js';

export const router = express.Router();

// POST /auth/register  (create user in "unverified" state)
router.post('/register', async (req, res) => {
  const { email, password } = req.body;
  // TODO: validate, hash password, rate-limit, CAPTCHA, generic errors (no user enumeration)
  const user = await prisma.user.create({ data: { email, /* passwordHash */ } });

  // create email verification token
  const raw = newRawToken();
  const tokenHash = await hashToken(raw);
  await prisma.verificationToken.create({
    data: {
      userId: user.id,
      type: 'email',
      tokenHash,
      expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24), // 24h
    }
  });

  // send magic link
  const link = `${process.env.PUBLIC_BASE_URL}/verify-email?token=${raw}&uid=${user.id}`;
  // send with Postmark/Resend/SendGrid — set SPF, DKIM, DMARC
  await sendTransactionalEmail(email, 'Verify your email', { link });

  res.status(200).json({ ok: true });
});

// GET /auth/verify-email
router.get('/verify-email', async (req, res) => {
  const { token, uid } = req.query;
  const record = await prisma.verificationToken.findFirst({
    where: { userId: uid, type: 'email', consumedAt: null, expiresAt: { gt: new Date() } },
    orderBy: { createdAt: 'desc' }
  });
  if (!record) return res.status(400).send('Invalid or expired');

  const ok = await verifyHash(token, record.tokenHash);
  if (!ok) return res.status(400).send('Invalid or expired');

  await prisma.$transaction([
    prisma.user.update({ where: { id: uid }, data: { emailVerifiedAt: new Date() } }),
    prisma.verificationToken.update({ where: { id: record.id }, data: { consumedAt: new Date() } }),
  ]);

  // redirect into app
  res.redirect('/?verified=1');
});

// POST /auth/resend-email
router.post('/resend-email', async (req, res) => {
  // rate-limit per user/IP, rotate previous tokens (mark consumed)
});
