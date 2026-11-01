import express from 'express';
import pkg from '@prisma/client';
const { PrismaClient } = pkg;

const prisma = new PrismaClient();

import { requireAuth, requireAdmin } from '../middleware/auth.js';

const router = express.Router();

router.use(requireAuth, requireAdmin);

// GET /admin/users?query=&take=50&skip=0
router.get('/', async (req, res) => {
  try {
    const take = Math.min(parseInt(req.query.take ?? '50', 10), 200);
    const skip = parseInt(req.query.skip ?? '0', 10);
    const q = (req.query.query || '').toString().trim();

    const where = q
      ? {
          OR: [
            { username: { contains: q, mode: 'insensitive' } },
            { email: { contains: q, mode: 'insensitive' } },
            { phoneNumber: { contains: q } },
          ],
        }
      : {};

    const [items, total] = await Promise.all([
      prisma.user.findMany({
        where,
        take,
        skip,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          username: true,
          email: true,
          phoneNumber: true,
          role: true,
          isBanned: true,
          preferredLanguage: true,
          allowExplicitContent: true,
          showOriginalWithTranslation: true,
          enableAIResponder: true,
          enableReadReceipts: true,
          createdAt: true,
        },
      }),
      prisma.user.count({ where }),
    ]);

    res.json({ items, total });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to list users' });
  }
});

// PATCH /admin/users/:id/role { role: 'ADMIN' | 'USER' }
router.patch('/:id/role', async (req, res) => {
  try {
    const id = Number(req.params.id);
    const { role } = req.body || {};
    if (!['ADMIN', 'USER'].includes(role)) {
      return res.status(400).json({ error: 'Invalid role' });
    }

    // Role changes revoke existing sessions so old credentials
    // cannot inherit newly granted administrator privileges.
    const updated = await prisma.user.update({
      where: { id },
      data: {
        role,
        tokenVersion: { increment: 1 },
      },
    });

    // audit
    res.locals.audit = {
      action: 'ADMIN_CHANGE_ROLE',
      targetUserId: id,
      notes: `Role -> ${role}`,
    };

    res.json(updated);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to change role' });
  }
});

// PATCH /admin/users/:id/flags { allowExplicitContent?, showOriginalWithTranslation?, enableAIResponder?, enableReadReceipts? }
router.patch('/:id/flags', async (req, res) => {
  try {
    const id = Number(req.params.id);
    const data = {};
    [
      'allowExplicitContent',
      'showOriginalWithTranslation',
      'enableAIResponder',
      'enableReadReceipts',
    ].forEach((k) => req.body[k] !== undefined && (data[k] = !!req.body[k]));

    const updated = await prisma.user.update({ where: { id }, data });

    // audit
    res.locals.audit = {
      action: 'ADMIN_UPDATE_FLAGS',
      targetUserId: id,
      notes: JSON.stringify(data),
    };

    res.json(updated);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to update flags' });
  }
});

// POST /admin/users/:id/ban { reason? }
router.post('/:id/ban', async (req, res) => {
  try {
    const id = Number(req.params.id);
    const reason = (req.body?.reason || '').toString();

    const updated = await prisma.user.update({
      where: { id },
      data: { isBanned: true, bannedAt: new Date() },
    });

    // audit
    res.locals.audit = {
      action: 'ADMIN_BAN_USER',
      targetUserId: id,
      notes: reason || 'no reason provided',
    };

    res.json({
      success: true,
      user: { id: updated.id, isBanned: updated.isBanned },
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to ban user' });
  }
});

// POST /admin/users/:id/unban { reason? }
router.post('/:id/unban', async (req, res) => {
  try {
    const id = Number(req.params.id);
    const reason = (req.body?.reason || '').toString();

    const updated = await prisma.user.update({
      where: { id },
      data: { isBanned: false, bannedAt: null },
    });

    // audit
    res.locals.audit = {
      action: 'ADMIN_UNBAN_USER',
      targetUserId: id,
      notes: reason || '',
    };

    res.json({
      success: true,
      user: { id: updated.id, isBanned: updated.isBanned },
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to unban user' });
  }
});

// DELETE /admin/users/:id (hard delete – optional, use sparingly)
router.delete('/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    await prisma.user.delete({ where: { id } });

    // audit
    res.locals.audit = {
      action: 'ADMIN_DELETE_USER',
      targetUserId: id,
      notes: 'hard delete',
    };

    res.json({ success: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to delete user' });
  }
});

export default router;
