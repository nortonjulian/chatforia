import express from 'express';
import Boom from '@hapi/boom';
import prisma from '../utils/prismaClient.js';
import { requireAuth } from '../middleware/auth.js';
import { asyncHandler } from '../utils/asyncHandler.js';

const router = express.Router();

/* =========================
 * Helpers
 * ========================= */

function normalizeMediaKind(kind, mimeType) {
  const k = String(kind || '').toLowerCase();
  if (k === 'image' || k === 'video' || k === 'audio' || k === 'file') return k;

  const up = String(kind || '').toUpperCase();
  if (up === 'IMAGE') return 'image';
  if (up === 'VIDEO') return 'video';
  if (up === 'AUDIO') return 'audio';
  if (up === 'FILE') return 'file';

  const mt = String(mimeType || '');
  if (mt.startsWith('image/')) return 'image';
  if (mt.startsWith('video/')) return 'video';
  if (mt.startsWith('audio/')) return 'audio';
  return 'file';
}

function summarizeAttachments(atts = []) {
  const list = Array.isArray(atts) ? atts : [];
  const mediaKinds = [];
  let thumbUrl = null;

  for (const a of list) {
    const k = normalizeMediaKind(a?.kind, a?.mimeType);
    if (k && !mediaKinds.includes(k)) mediaKinds.push(k);
    if (!thumbUrl && k === 'image') thumbUrl = a?.url || null;
  }

  return {
    hasMedia: list.length > 0,
    mediaCount: list.length,
    mediaKinds,
    thumbUrl,
  };
}

function summarizeSmsMedia(mediaUrls) {
  const list = Array.isArray(mediaUrls) ? mediaUrls : [];
  return {
    hasMedia: list.length > 0,
    mediaCount: list.length,
    mediaKinds: list.length ? ['image'] : [],
    thumbUrl: list[0] || null,
  };
}

function buildLastPreviewText({ text, hasMedia, mediaKinds }) {
  const t = String(text || '').trim();
  if (t) return t;

  if (!hasMedia) return '';

  const kinds = Array.isArray(mediaKinds) ? mediaKinds : [];
  if (kinds.includes('image')) return '📷 Photo';
  if (kinds.includes('video')) return '🎥 Video';
  if (kinds.includes('audio')) return '🎙️ Audio';
  return '📎 Attachment';
}

/* =========================
 * Routes
 * ========================= */

router.get(
  '/',
  requireAuth,
  asyncHandler(async (req, res) => {
    const userId = Number(req.user?.id);
    if (!userId) throw Boom.unauthorized('Not authenticated');

    // -----------------------
    // Rooms (app-to-app chats)
    // ✅ filter out archived for THIS user via Participant.archivedAt
    // -----------------------
    const rooms = await prisma.chatRoom.findMany({
      where: {
        participants: {
          some: { userId, archivedAt: null },
        },
      },
      select: {
        id: true,
        name: true,
        updatedAt: true,
        isGroup: true,
        messages: {
          select: {
            id: true,
            rawContent: true,
            translatedContent: true,
            deletedBySender: true, // legacy
            deletedForAll: true, // new
            createdAt: true,
            attachments: {
              select: {
                kind: true,
                mimeType: true,
                url: true,
              },
              take: 12,
            },
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
      const atts = lastMsg?.attachments || [];
      const media = summarizeAttachments(atts);

      const deleted =
        Boolean(lastMsg?.deletedForAll) || Boolean(lastMsg?.deletedBySender);

      const previewText = !lastMsg
        ? ''
        : deleted
          ? '(deleted)'
          : buildLastPreviewText({
              text: (lastMsg.translatedContent || lastMsg.rawContent || '').trim(),
              hasMedia: media.hasMedia,
              mediaKinds: media.mediaKinds,
            });

      const title = r.name || `Chat #${r.id}`;

      return {
        kind: 'chat',
        id: r.id,
        title,
        updatedAt: (r.updatedAt || new Date()).toISOString(),
        isGroup: Boolean(r.isGroup),
        last: lastMsg?.createdAt
          ? {
              text: previewText,
              messageId: lastMsg.id,
              at: lastMsg.createdAt.toISOString(),
              ...media,
            }
          : null,
        unreadCount: 0,
      };
    });

    // ----------------
    // SMS / MMS threads
    // ✅ filter out archived threads
    // ----------------
    const smsThreads = await prisma.smsThread.findMany({
      where: { userId, archivedAt: null },
      select: {
        id: true,
        contactPhone: true,
        updatedAt: true,
        messages: {
          select: { id: true, body: true, mediaUrls: true, createdAt: true },
          orderBy: { createdAt: 'desc' },
          take: 1,
        },
      },
      orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
      take: 200,
    });

    const smsConvos = smsThreads.map((t) => {
      const lastMsg = t.messages?.[0] || null;
      const media = summarizeSmsMedia(lastMsg?.mediaUrls);

      const previewText = buildLastPreviewText({
        text: String(lastMsg?.body || ''),
        hasMedia: media.hasMedia,
        mediaKinds: media.mediaKinds,
      });

      return {
        kind: 'sms',
        id: t.id,
        title: t.contactPhone,
        phone: t.contactPhone,
        updatedAt: (t.updatedAt || new Date()).toISOString(),
        isGroup: false,
        last: lastMsg?.createdAt
          ? {
              text: previewText,
              messageId: lastMsg.id,
              at: lastMsg.createdAt.toISOString(),
              ...media,
            }
          : null,
        unreadCount: 0,
      };
    });

    const all = [...chatConvos, ...smsConvos].sort((a, b) => {
      const ta = new Date(a.updatedAt).getTime();
      const tb = new Date(b.updatedAt).getTime();
      return tb - ta;
    });

    return res.json({ items: all, conversations: all });
  })
);

router.patch(
  '/:kind/:id/archive',
  requireAuth,
  asyncHandler(async (req, res) => {
    const userId = Number(req.user?.id);
    const kind = String(req.params.kind);
    const id = req.params.id;
    const archived = Boolean(req.body?.archived);

    if (kind === 'chat') {
      const chatRoomId = Number(id);
      if (!Number.isFinite(chatRoomId)) throw Boom.badRequest('Invalid chat id');

      await prisma.participant.update({
        where: { chatRoomId_userId: { chatRoomId, userId } },
        data: { archivedAt: archived ? new Date() : null },
      });

      return res.json({ ok: true });
    }

    if (kind === 'sms') {
      const threadId = Number(id);
      if (!Number.isFinite(threadId)) throw Boom.badRequest('Invalid sms id');

      await prisma.smsThread.updateMany({
        where: { id: threadId, userId },
        data: { archivedAt: archived ? new Date() : null },
      });

      return res.json({ ok: true });
    }

    throw Boom.badRequest('Unknown kind');
  })
);

export default router;
