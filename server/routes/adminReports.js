import express from 'express';
import pkg from '@prisma/client';
const { PrismaClient } = pkg;

const prisma = new PrismaClient();

import { requireAuth, requireAdmin } from '../middleware/auth.js';

const router = express.Router();

// GET /admin/reports?status=OPEN&take=50&skip=0
router.get('/', requireAuth, requireAdmin, async (req, res) => {
  try {
    const take = Math.min(parseInt(req.query.take ?? '50', 10), 200);
    const skip = parseInt(req.query.skip ?? '0', 10);
    const status = (req.query.status ?? '').toString().toUpperCase();

    const where = status ? { status } : {};
    const [items, total] = await Promise.all([
      prisma.report.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take,
        skip,
        include: {
          reporter: { select: { id: true, username: true, email: true } },
          reportedUser: { select: { id: true, username: true, email: true } },
          message: {
            select: {
              id: true,
              rawContent: true,
              translatedContent: true,
              chatRoomId: true,
              createdAt: true,
              sender: { select: { id: true, username: true, isBanned: true } },
            },
          },
        },
      }),
      prisma.report.count({ where }),
    ]);

    res.json({ items, total });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to list reports' });
  }
});

// PATCH /admin/reports/:id/resolve { notes? }
router.patch('/:id/resolve', requireAuth, requireAdmin, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const { notes } = req.body || {};
    const updated = await prisma.report.update({
      where: { id },
      data: {
        status: 'RESOLVED',
        notes: notes || null,
        resolvedAt: new Date(),
      },
    });

    // audit
    res.locals.audit = {
      action: 'ADMIN_RESOLVE_REPORT',
      targetReportId: id,
      notes: notes || '',
    };

    res.json(updated);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to resolve report' });
  }
});

// POST /admin/reports/users/:userId/warn { notes? }
router.post('/users/:userId/warn', requireAuth, requireAdmin, async (req, res) => {
  try {
    const userId = Number(req.params.userId);
    const { notes } = req.body || {};

    // audit only (optional persistence if you add a Warning model)
    res.locals.audit = {
      action: 'ADMIN_WARN_USER',
      targetUserId: userId,
      notes: notes || 'warned',
    };

    res.json({ success: true, userId, notes: notes || 'warned' });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to warn user' });
  }
});

// POST /admin/reports/users/:userId/ban { reason? }
router.post('/users/:userId/ban', requireAuth, requireAdmin, async (req, res) => {
  try {
    const userId = Number(req.params.userId);
    const { reason } = req.body || {};
    const updated = await prisma.user.update({
      where: { id: userId },
      data: { isBanned: true, bannedAt: new Date() },
    });

    // audit
    res.locals.audit = {
      action: 'ADMIN_BAN_USER',
      targetUserId: userId,
      notes: reason || '',
    };

    res.json({
      success: true,
      user: { id: updated.id, isBanned: updated.isBanned },
      reason: reason || '',
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to ban user' });
  }
});

// DELETE /admin/reports/messages/:messageId
// Admin removal for everyone: blank content fields but keep the record for ordering/audit
router.delete('/messages/:messageId', requireAuth, requireAdmin, async (req, res) => {
  try {
    const messageId = Number(req.params.messageId);

    const updated = await prisma.message.update({
      where: { id: messageId },
      data: {
        contentCiphertext: '',
        rawContent: null,
        translatedContent: null,
        // if your schema has a dedicated flag, set it here as well:
        // deletedByAdmin: true,
      },
      select: { id: true, chatRoomId: true, senderId: true },
    });

    // audit
    res.locals.audit = {
      action: 'ADMIN_DELETE_MESSAGE',
      targetMessageId: messageId,
      notes: 'content blanked by admin',
    };

    res.json({ success: true, message: updated });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to delete message' });
  }
});

export default router;
