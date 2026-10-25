import express from 'express';
import Boom from '@hapi/boom';
import { asyncHandler } from '../utils/asyncHandler.js';
import { requireAuth } from '../middleware/auth.js';
import { requireRoomAdmin } from '../middleware/roomAuth.js';
import prisma from '../utils/prismaClient.js';

const router = express.Router();

// Simple feature flag check (optional)
router.get('/', (_req, res) => {
  res.json({ status: process.env.STATUS_ENABLED === 'true' });
});

// Toggle room auto-translate mode: 'off' | 'tagged' | 'all'
router.patch(
  '/rooms/:id/auto-translate',
  requireAuth,
  requireRoomAdmin('id'), // ensures the caller is an admin of :id
  asyncHandler(async (req, res) => {
    const chatRoomId = Number(req.params.id);
    if (!Number.isFinite(chatRoomId)) throw Boom.badRequest('Invalid room id');

    const v = String(req.body.mode || '').toUpperCase();
    if (!['OFF', 'TAGGED', 'ALL'].includes(v))
      throw Boom.badRequest('Invalid mode');

    const updated = await prisma.chatRoom.update({
      where: { id: chatRoomId },
      data: { autoTranslateMode: v },
      select: { id: true, name: true, autoTranslateMode: true },
    });

    res.json(updated);
  })
);

export default router;
