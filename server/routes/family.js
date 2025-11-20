import express from 'express';
import { PrismaClient } from '@prisma/client';
import crypto from 'crypto';

const prisma = new PrismaClient();
const router = express.Router();

// Helper: require auth middleware sets req.user
function requireAuth(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Not authenticated' });
  next();
}

// GET /family/me – summary for current user
router.get('/me', requireAuth, async (req, res) => {
  try {
    const userId = req.user.id;

    const membership = await prisma.familyMember.findFirst({
      where: { userId },
      include: {
        group: {
          include: {
            members: {
              include: { user: true },
            },
          },
        },
      },
    });

    if (!membership) {
      return res.json({ family: null });
    }

    const { group } = membership;

    return res.json({
      family: {
        id: group.id,
        name: group.name,
        role: membership.role,
        totalDataMb: group.totalDataMb,
        usedDataMb: group.usedDataMb,
        members: group.members.map((m) => ({
          id: m.id,
          userId: m.userId,
          role: m.role,
          limitDataMb: m.limitDataMb,
          usedDataMb: m.usedDataMb,
          displayName: m.user?.displayName || m.user?.email || 'Member',
        })),
      },
    });
  } catch (e) {
    console.error('GET /family/me error', e);
    res.status(500).json({ error: 'Failed to load family' });
  }
});

// POST /family/invite – create an invite for current user's family
// POST /family/invite – create an invite for current user's family
router.post('/invite', requireAuth, async (req, res) => {
  try {
    const userId = req.user.id;
    const { email, phone } = req.body || {};

    // 🚫 Require Premium plan to send invites / own a family
    if (req.user.plan !== 'PREMIUM') {
      return res
        .status(402) // Payment Required is semantically correct here
        .json({ error: 'Family plan required' });
    }

    const membership = await prisma.familyMember.findFirst({
      where: { userId },
      include: { group: true },
    });

    if (!membership || membership.role !== 'OWNER') {
      return res.status(403).json({ error: 'Not family owner' });
    }

    const token = crypto.randomBytes(24).toString('hex');
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

    const invite = await prisma.familyInvite.create({
      data: {
        groupId: membership.groupId,
        email: email || null,
        phone: phone || null,
        token,
        expiresAt,
      },
    });

    return res.json({
      invite: {
        token: invite.token,
        joinUrl: `${process.env.APP_BASE_URL || 'https://chatforia.app'}/family/join/${invite.token}`,
        expiresAt: invite.expiresAt,
      },
    });
  } catch (e) {
    console.error('POST /family/invite error', e);
    res.status(500).json({ error: 'Failed to create invite' });
  }
});

// POST /family/join – accept invite using token
router.post('/join', requireAuth, async (req, res) => {
  try {
    const userId = req.user.id;
    const { token } = req.body || {};
    if (!token) return res.status(400).json({ error: 'Missing token' });

    const invite = await prisma.familyInvite.findUnique({
      where: { token },
      include: { group: true },
    });

    if (
      !invite ||
      invite.status !== 'PENDING' ||
      (invite.expiresAt && invite.expiresAt < new Date())
    ) {
      return res.status(400).json({ error: 'Invalid or expired invite' });
    }

    // Check if user already in a family
    const existingMembership = await prisma.familyMember.findFirst({
      where: { userId },
    });
    if (existingMembership) {
      return res.status(400).json({ error: 'You already belong to a family' });
    }

    await prisma.$transaction([
      prisma.familyMember.create({
        data: {
          groupId: invite.groupId,
          userId,
          role: 'MEMBER',
        },
      }),
      prisma.familyInvite.update({
        where: { id: invite.id },
        data: { status: 'ACCEPTED', acceptedAt: new Date() },
      }),
    ]);

    return res.json({ ok: true });
  } catch (e) {
    console.error('POST /family/join error', e);
    res.status(500).json({ error: 'Failed to join family' });
  }
});

export default router;
