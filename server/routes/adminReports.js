import express from 'express';
import pkg from '@prisma/client';
const { PrismaClient } = pkg;

import { requireAuth, requireAdmin } from '../middleware/auth.js';

const prisma = new PrismaClient();
const router = express.Router();

function parsePositiveInt(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isNaN(parsed) || parsed < 0 ? fallback : parsed;
}

// GET /admin/reports?status=OPEN&take=50&skip=0
router.get('/', requireAuth, requireAdmin, async (req, res) => {
  try {
    const take = Math.min(parsePositiveInt(req.query.take, 50), 200);
    const skip = parsePositiveInt(req.query.skip, 0);
    const status = (req.query.status ?? '').toString().trim().toUpperCase();

    const where = status ? { status } : {};

    const [items, total] = await Promise.all([
      prisma.report.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take,
        skip,
        include: {
          reporter: {
            select: {
              id: true,
              username: true,
              email: true,
            },
          },
          reportedUser: {
            select: {
              id: true,
              username: true,
              email: true,
              isBanned: true,
            },
          },
          message: {
            select: {
              id: true,
              rawContent: true,
              translatedContent: true,
              chatRoomId: true,
              createdAt: true,
              sender: {
                select: {
                  id: true,
                  username: true,
                  isBanned: true,
                },
              },
            },
          },
        },
      }),
      prisma.report.count({ where }),
    ]);

    res.json({ items, total });
  } catch (e) {
    console.error('GET /admin/reports failed:', e);
    res.status(500).json({ error: 'Failed to list reports' });
  }
});

// PATCH /admin/reports/:id/resolve { notes? }
router.patch('/:id/resolve', requireAuth, requireAdmin, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      return res.status(400).json({ error: 'Invalid report id' });
    }

    const { notes } = req.body || {};

    const updated = await prisma.report.update({
      where: { id },
      data: {
        status: 'RESOLVED',
        notes: notes || null,
        resolvedAt: new Date(),
      },
    });

    res.locals.audit = {
      action: 'ADMIN_RESOLVE_REPORT',
      targetReportId: id,
      notes: notes || '',
    };

    res.json(updated);
  } catch (e) {
    console.error(`PATCH /admin/reports/${req.params.id}/resolve failed:`, e);
    res.status(500).json({ error: 'Failed to resolve report' });
  }
});

// POST /admin/reports/users/:userId/warn { notes? }
router.post('/users/:userId/warn', requireAuth, requireAdmin, async (req, res) => {
  try {
    const userId = Number(req.params.userId);
    if (!Number.isInteger(userId)) {
      return res.status(400).json({ error: 'Invalid user id' });
    }

    const { notes } = req.body || {};

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true },
    });

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.locals.audit = {
      action: 'ADMIN_WARN_USER',
      targetUserId: userId,
      notes: notes || 'warned',
    };

    res.json({ success: true, userId, notes: notes || 'warned' });
  } catch (e) {
    console.error(`POST /admin/reports/users/${req.params.userId}/warn failed:`, e);
    res.status(500).json({ error: 'Failed to warn user' });
  }
});

// POST /admin/reports/users/:userId/ban { reason? }
router.post('/users/:userId/ban', requireAuth, requireAdmin, async (req, res) => {
  try {
    const userId = Number(req.params.userId);
    if (!Number.isInteger(userId)) {
      return res.status(400).json({ error: 'Invalid user id' });
    }

    const { reason } = req.body || {};

    const updated = await prisma.user.update({
      where: { id: userId },
      data: {
        isBanned: true,
        bannedAt: new Date(),
      },
      select: {
        id: true,
        isBanned: true,
        bannedAt: true,
      },
    });

    res.locals.audit = {
      action: 'ADMIN_BAN_USER',
      targetUserId: userId,
      notes: reason || '',
    };

    res.json({
      success: true,
      user: updated,
      reason: reason || '',
    });
  } catch (e) {
    console.error(`POST /admin/reports/users/${req.params.userId}/ban failed:`, e);
    res.status(500).json({ error: 'Failed to ban user' });
  }
});

// DELETE /admin/reports/messages/:messageId
// Admin removal for everyone: blank content fields but keep the record for ordering/audit
router.delete('/messages/:messageId', requireAuth, requireAdmin, async (req, res) => {
  try {
    const messageId = Number(req.params.messageId);
    if (!Number.isInteger(messageId)) {
      return res.status(400).json({ error: 'Invalid message id' });
    }

    const updated = await prisma.message.update({
      where: { id: messageId },
      data: {
        contentCiphertext: '',
        rawContent: null,
        translatedContent: null,
        // deletedByAdmin: true,
      },
      select: {
        id: true,
        chatRoomId: true,
        senderId: true,
      },
    });

    res.locals.audit = {
      action: 'ADMIN_DELETE_MESSAGE',
      targetMessageId: messageId,
      notes: 'content blanked by admin',
    };

    res.json({ success: true, message: updated });
  } catch (e) {
    console.error(
      `DELETE /admin/reports/messages/${req.params.messageId} failed:`,
      e
    );
    res.status(500).json({ error: 'Failed to delete message' });
  }
});

export default router;