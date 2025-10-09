import express from 'express';
import crypto from 'node:crypto';
import prisma from '../../utils/prismaClient.js';
import { sendMail } from '../../utils/sendMail.js';

export const router = express.Router();

// POST /auth/email/send  { email?: string }
// If user is logged in you can take email from session; adjust as needed.
router.post('/email/send', async (req, res) => {
  const { email } = req.body || {};
  if (!email) return res.status(400).json({ ok: false, error: 'Missing email' });

  // find user
  const user = await prisma.user.findFirst({ where: { email: { equals: email, mode: 'insensitive' } }, select: { id: true, email: true } });
  if (!user) return res.json({ ok: true }); // do not reveal existence

  // create token (hash only in DB)
  const token = crypto.randomBytes(32).toString('hex');
  const tokenHash = crypto.createHash('sha256').update(token, 'utf8').digest('hex');
  const expiresAt = new Date(Date.now() + 1000 * 60 * 60); // 1h

  await prisma.verificationToken.create({
    data: {
      userId: user.id,
      type: 'EMAIL',
      tokenHash,
      expiresAt,
    },
  });

  const base = (process.env.PUBLIC_BASE_URL || 'http://localhost:5173').replace(/\/+$/, '');
  const link = `${base}/verify-email?token=${encodeURIComponent(token)}`;

  const html = `<p>Verify your email for Chatforia</p><p><a href="${link}">Verify Email</a></p>`;
  const { previewUrl } = await sendMail(user.email, 'Verify your email', html);

  res.json({ ok: true, previewUrl });
});

// GET /auth/email/verify?token=...
router.get('/email/verify', async (req, res) => {
  const token = String(req.query.token || '');
  if (!token) return res.status(400).json({ ok: false, error: 'Missing token' });

  const tokenHash = crypto.createHash('sha256').update(token, 'utf8').digest('hex');

  const vt = await prisma.verificationToken.findFirst({
    where: { tokenHash, type: 'EMAIL', usedAt: null },
    select: { id: true, userId: true, expiresAt: true },
  });
  if (!vt) return res.status(400).json({ ok: false, error: 'invalid' });
  if (vt.expiresAt.getTime() < Date.now()) return res.status(400).json({ ok: false, error: 'expired' });

  await prisma.$transaction([
    prisma.user.update({
      where: { id: vt.userId },
      data: { emailVerifiedAt: new Date(), emailVerifiedIp: null }, // fill IP from req if you store it
    }),
    prisma.verificationToken.update({
      where: { id: vt.id },
      data: { usedAt: new Date() },
    }),
  ]);

  res.json({ ok: true });
});
