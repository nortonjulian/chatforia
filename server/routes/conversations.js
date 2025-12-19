import express from 'express';
import Boom from '@hapi/boom';
import prisma from '../utils/prismaClient.js';
import { requireAuth } from '../middleware/auth.js';
import { asyncHandler } from '../utils/asyncHandler.js';

const router = express.Router();

/**
 * GET /conversations
 * Unified list of:
 * - app-to-app chat rooms (ChatRoom)
 * - SMS threads (SmsThread)
 *
 * Returns a single array sorted by updatedAt desc.
 */
router.get(
  '/',
  requireAuth,
  asyncHandler(async (req, res) => {
    const userId = Number(req.user?.id);
    if (!userId) throw Boom.unauthorized('Not authenticated');

    // -----------------------
    // Rooms (app-to-app chats)
    // -----------------------
    const rooms = await prisma.chatRoom.findMany({
      where: {
        participants: {
          some: { userId },
        },
      },
      select: {
        id: true,
        name: true,
        updatedAt: true,
        messages: {
          select: {
            rawContent: true,
            translatedContent: true,
            imageUrl: true,
            audioUrl: true,
            deletedBySender: true,
            createdAt: true,
          },
          orderBy: { createdAt: 'desc' },
          take: 1,
        },
      },
      orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
      take: 200,
    });

    const chatConvos = rooms.map((r) => {
      const lastMsg = r.messages?.[0] || null;

      const previewText = !lastMsg
        ? ''
        : lastMsg.deletedBySender
          ? '(deleted)'
          : (
              (lastMsg.translatedContent || lastMsg.rawContent || '').trim() ||
              (lastMsg.imageUrl ? '(photo)' : '') ||
              (lastMsg.audioUrl ? '(voice note)' : '') ||
              ''
            );

      const title = r.name || `Chat #${r.id}`;

      return {
        kind: 'chat',
        id: r.id,
        title,
        updatedAt: (r.updatedAt || new Date()).toISOString(),
        last: lastMsg?.createdAt
          ? { text: previewText, at: lastMsg.createdAt.toISOString() }
          : null,
        unreadCount: 0,
      };
    });

    // ----------------
    // SMS threads
    // ----------------
    const smsThreads = await prisma.smsThread.findMany({
      where: { userId },
      select: {
        id: true,
        contactPhone: true,
        updatedAt: true,
        messages: {
          select: { body: true, createdAt: true },
          orderBy: { createdAt: 'desc' },
          take: 1,
        },
      },
      orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
      take: 200,
    });

    const smsConvos = smsThreads.map((t) => {
      const lastMsg = t.messages?.[0] || null;
      return {
        kind: 'sms',
        id: t.id,
        title: t.contactPhone,
        updatedAt: (t.updatedAt || new Date()).toISOString(),
        last: lastMsg?.createdAt
          ? { text: String(lastMsg.body || ''), at: lastMsg.createdAt.toISOString() }
          : null,
        unreadCount: 0,
      };
    });

    const all = [...chatConvos, ...smsConvos].sort((a, b) => {
      const ta = new Date(a.updatedAt).getTime();
      const tb = new Date(b.updatedAt).getTime();
      return tb - ta;
    });

    res.json({ conversations: all });
  })
);

export default router;
