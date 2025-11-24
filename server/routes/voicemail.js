import express from 'express';
import prisma from '../utils/prismaClient.js';
import { requireAuth } from '../middleware/auth.js';
import { asyncHandler } from '../utils/asyncHandler.js';

const r = express.Router();

// All voicemail routes require auth
r.use(requireAuth);

/**
 * GET /api/voicemail
 *
 * Return the current user's voicemails (excluding soft-deleted),
 * newest first.
 */
r.get(
  '/',
  asyncHandler(async (req, res) => {
    const userId = Number(req.user.id);

    const voicemails = await prisma.voicemail.findMany({
      where: {
        userId,
        deleted: false,
      },
      orderBy: {
        createdAt: 'desc',
      },
    });

    res.json({ voicemails });
  }),
);

/**
 * PATCH /api/voicemail/:id/read
 *
 * Body: { isRead?: boolean }
 * Mark a voicemail as read/unread for the current user.
 */
r.patch(
  '/:id/read',
  express.json(),
  asyncHandler(async (req, res) => {
    const userId = Number(req.user.id);
    const { id } = req.params;
    const { isRead = true } = req.body ?? {};

    const result = await prisma.voicemail.updateMany({
      where: {
        id,
        userId,
        deleted: false,
      },
      data: {
        isRead: Boolean(isRead),
      },
    });

    if (result.count === 0) {
      return res.status(404).json({ error: 'Voicemail not found' });
    }

    res.json({ success: true });
  }),
);

/**
 * DELETE /api/voicemail/:id
 *
 * Soft delete a voicemail for the current user.
 */
r.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const userId = Number(req.user.id);
    const { id } = req.params;

    const result = await prisma.voicemail.updateMany({
      where: {
        id,
        userId,
        deleted: false,
      },
      data: {
        deleted: true,
        // If you later add a deletedAt field, you can also set:
        // deletedAt: new Date(),
      },
    });

    if (result.count === 0) {
      return res.status(404).json({ error: 'Voicemail not found' });
    }

    res.json({ success: true });
  }),
);

export default r;
