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

function normalizeSmsMediaUrls(mediaUrls) {
  if (Array.isArray(mediaUrls)) return mediaUrls.filter(Boolean);
  if (mediaUrls && typeof mediaUrls === 'object') return Object.values(mediaUrls).filter(Boolean);
  return [];
}

function summarizeSmsMedia(mediaUrls) {
  const list = normalizeSmsMediaUrls(mediaUrls);
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

// keep digits and a leading +
function normalizePhoneForMatch(raw) {
  const s = String(raw || '').trim();
  if (!s) return '';
  return s.replace(/[^\d+]/g, '');
}

// produce both + and no-plus keys for matching
function phoneKeys(raw) {
  const cleaned = normalizePhoneForMatch(raw);
  if (!cleaned) return [];
  const noPlus = cleaned.startsWith('+') ? cleaned.slice(1) : cleaned;
  const withPlus = cleaned.startsWith('+') ? cleaned : `+${cleaned}`;
  return [...new Set([withPlus, noPlus].filter(Boolean))];
}

function pickCounterpartyPhoneFromLastMessage(thread) {
  // ✅ BEST: use canonical contactPhone if present
  const cp = normalizePhoneForMatch(thread?.contactPhone || '');
  if (cp) return cp;

  // Otherwise infer from last message
  const last = thread?.messages?.[0];
  if (last?.direction === 'out') return normalizePhoneForMatch(last.toNumber);
  if (last?.direction === 'in') return normalizePhoneForMatch(last.fromNumber);

  // fallback to participant
  const p0 = thread?.participants?.[0]?.phone || '';
  return normalizePhoneForMatch(p0);
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
            deletedBySender: true,
            deletedForAll: true,
            createdAt: true,
            attachments: {
              select: { kind: true, mimeType: true, url: true },
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
      const media = summarizeAttachments(lastMsg?.attachments || []);

      const deleted = Boolean(lastMsg?.deletedForAll) || Boolean(lastMsg?.deletedBySender);

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
    // ----------------
    const smsThreads = await prisma.smsThread.findMany({
      where: { userId, archivedAt: null },
      select: {
        id: true,
        updatedAt: true,
        // ✅ FIX: include contactPhone so we ALWAYS have the counterparty
        contactPhone: true,
        participants: { select: { phone: true }, take: 5 },
        messages: {
          select: {
            id: true,
            body: true,
            mediaUrls: true,
            createdAt: true,
            direction: true,
            fromNumber: true,
            toNumber: true,
          },
          orderBy: { createdAt: 'desc' },
          take: 1,
        },
      },
      orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
      take: 200,
    });

    // collect all phone variants for contact lookup
    const phoneVariantSet = new Set();

    for (const t of smsThreads) {
      const p = pickCounterpartyPhoneFromLastMessage(t);
      for (const k of phoneKeys(p)) phoneVariantSet.add(k);
    }

    const phoneVariants = [...phoneVariantSet];

    const contacts = phoneVariants.length
      ? await prisma.contact.findMany({
          where: {
            ownerId: userId,
            externalPhone: { in: phoneVariants },
          },
          select: {
            externalPhone: true,
            alias: true,
            externalName: true,
            user: { select: { username: true } },
          },
        })
      : [];

    // ✅ map BOTH + and no-plus keys → same display value
    const contactNameByPhone = new Map();
    for (const c of contacts) {
      const value = c.alias || c.externalName || c.user?.username || c.externalPhone;
      for (const k of phoneKeys(c.externalPhone)) {
        contactNameByPhone.set(k, value);
      }
    }

    const smsConvos = smsThreads.map((t) => {
      const lastMsg = t.messages?.[0] || null;
      const media = summarizeSmsMedia(lastMsg?.mediaUrls);

      const phone = pickCounterpartyPhoneFromLastMessage(t);

      const title =
        contactNameByPhone.get(phoneKeys(phone)[0]) ||
        contactNameByPhone.get(phoneKeys(phone)[1]) ||
        phone ||
        `SMS #${t.id}`;

      const previewText = buildLastPreviewText({
        text: String(lastMsg?.body || ''),
        hasMedia: media.hasMedia,
        mediaKinds: media.mediaKinds,
      });

      return {
        kind: 'sms',
        id: t.id,
        title,
        phone,
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
