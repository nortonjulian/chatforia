import { Router } from 'express';
import { OAuth2Client } from 'google-auth-library';
import prisma from '../utils/prismaClient.js';
import { issueSession } from './auth.js';

const router = Router();

const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

// POST /auth/oauth/google/ios
router.post('/google/ios', async (req, res) => {
  try {
    const { idToken } = req.body || {};

    if (!idToken) {
      return res.status(400).json({ error: 'Missing idToken' });
    }

    const ticket = await googleClient.verifyIdToken({
      idToken,
      audience: process.env.GOOGLE_CLIENT_ID,
    });

    const payload = ticket.getPayload();

    const googleSub = payload?.sub;
    const email = payload?.email ?? null;
    const name = payload?.name ?? null;
    const avatar = payload?.picture ?? null;

    if (!googleSub) {
      return res.status(400).json({ error: 'Invalid Google token' });
    }

    let user = await prisma.user.findFirst({
      where: { googleSub },
    });

    if (!user && email) {
      user = await prisma.user.findFirst({
        where: { email: { equals: email, mode: 'insensitive' } },
      });
    }

    if (!user) {
      user = await prisma.user.create({
        data: {
          username: `user_${Date.now()}`,
          email,
          displayName: name,
          avatarUrl: avatar,
          googleSub,
          passwordHash: 'oauth',
          emailVerifiedAt: email ? new Date() : null,
        },
      });
    } else if (!user.googleSub) {
      user = await prisma.user.update({
        where: { id: user.id },
        data: {
          googleSub,
          ...(avatar ? { avatarUrl: avatar } : {}),
          ...(name && !user.displayName ? { displayName: name } : {}),
          ...(email && !user.email ? { email } : {}),
          ...(email ? { emailVerifiedAt: user.emailVerifiedAt ?? new Date() } : {}),
        },
      });
    }

    const token = issueSession(res, user);

    return res.json({
      message: 'logged in',
      token,
      user: {
        id: user.id,
        email: user.email,
        username: user.username,
        publicKey: user.publicKey ?? null,
        plan: user.plan ?? 'FREE',
        role: user.role ?? 'USER',
      },
    });
  } catch (err) {
    console.error('Google iOS OAuth error:', err);
    return res.status(500).json({
      error: 'OAuth failed',
      details: err?.message || String(err),
    });
  }
});

export default router;