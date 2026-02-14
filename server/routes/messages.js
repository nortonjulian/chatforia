import express from 'express';
import Boom from '@hapi/boom';
import path from 'path';
import fs from 'fs';
import rateLimit from 'express-rate-limit';

import prisma from '../utils/prismaClient.js';
import { requireAuth } from '../middleware/auth.js';
import { requirePremium } from '../middleware/requirePremium.js';
import { audit } from '../middleware/audit.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { emitMessageNew } from '../services/socketBus.js';

// ✅ Use the service so SMS fan-out runs + translations/TTL live in one place
import { createMessageService } from '../services/messageService.js';

// Hardened upload + safety utilities
import { uploadMedia } from '../middleware/uploads.js';
import { scanFile } from '../utils/antivirus.js';
import { ensureThumb } from '../utils/thumbnailer.js';
import { signDownloadToken } from '../utils/downloadTokens.js';

// 🔁 Lazy, on-read translation (Google Cloud)
import { maybeTranslateForTarget } from '../services/translation/translateMessage.js';

// Media probe (durationSec for audio)
import { probeDurationSec } from '../utils/mediaProbe.js';

// In test mode, allow membership fallback & message memory
import { __mem as roomsMem } from './rooms.js';

const IS_TEST = String(process.env.NODE_ENV || '') === 'test';
const router = express.Router();

// ---- in-memory messages (test-only) ----------------------------------------
const mem = IS_TEST
  ? {
      nextId: 1,
      byId: new Map(), // id -> message
      byRoom: new Map(), // roomId -> [ids]
    }
  : null;

function memSaveMessage({
  chatRoomId,
  senderId,
  content = '',
  contentCiphertext = null,
  encryptedKeys = null,
  attachments = [],
}) {
  const id = mem.nextId++;
  const msg = {
    id,
    chatRoomId,
    senderId,
    rawContent: content || '',
    contentCiphertext: contentCiphertext || null,
    encryptedKeys: encryptedKeys || null,
    isExplicit: false,
    createdAt: new Date().toISOString(),
    attachments,
    readBy: [],
    deletedForAll: false,
    deletedAt: null,
    deletedById: null,
    editedAt: null,
  };
  mem.byId.set(id, msg);
  if (!mem.byRoom.has(chatRoomId)) mem.byRoom.set(chatRoomId, []);
  mem.byRoom.get(chatRoomId).push(id);
  return msg;
}
function memGetMessage(id) {
  return mem?.byId.get(id) || null;
}
function memEditMessage(id, newContent) {
  const m = memGetMessage(id);
  if (!m) return null;
  m.rawContent = newContent;
  m.editedAt = new Date().toISOString();
  m.updatedAt = new Date().toISOString();
  return m;
}

// ---- helpers ---------------------------------------------------------------
async function isMemberOrMemFallback(chatRoomId, userId) {
  const dbMember = await prisma.participant.findFirst({
    where: { chatRoomId, userId },
    select: { id: true },
  });
  if (dbMember) return true;
  if (IS_TEST) {
    return !!roomsMem?.members?.get(chatRoomId)?.has(userId);
  }
  return false;
}

// Per-endpoint rate limit for POST creates
const postMessageLimiter = rateLimit({
  windowMs: 10 * 1000, // 10s window
  max: 50,
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => req.method !== 'POST',
  trustProxy: false,
});

function normalizeMediaKind(kind, mimeType) {
  const up = String(kind || '').toUpperCase();
  if (up === 'IMAGE') return 'IMAGE';
  if (up === 'VIDEO') return 'VIDEO';
  if (up === 'AUDIO') return 'AUDIO';
  if (up === 'FILE') return 'FILE';

  const mt = String(mimeType || '');
  if (mt.startsWith('image/')) return 'IMAGE';
  if (mt.startsWith('video/')) return 'VIDEO';
  if (mt.startsWith('audio/')) return 'AUDIO';
  return 'FILE';
}

/**
 * CREATE message (HTTP)
 */
router.post(
  '/',
  postMessageLimiter,
  requireAuth,
  uploadMedia.array('files', 10),
  asyncHandler(async (req, res) => {
    const senderId = Number(req.user?.id);
    if (!senderId) throw Boom.unauthorized();

    const body = req.body || {};

    const clientMessageId =
      body.clientMessageId ?? body.client_message_id ?? body.cid ?? null;

    if (clientMessageId != null && typeof clientMessageId !== 'string') {
      throw Boom.badRequest('clientMessageId must be a string');
    }

    // Plaintext (optional)
    const content =
      body.content ??
      body.text ?? // legacy callers
      body.message ??
      '';

    // Client-side E2EE payloads
    const contentCiphertext = body.contentCiphertext ?? body.ciphertext ?? null;

    // encryptedKeys can arrive as object or JSON string
    let encryptedKeys = body.encryptedKeys ?? body.keys ?? null;
    if (typeof encryptedKeys === 'string') {
      try {
        encryptedKeys = JSON.parse(encryptedKeys);
      } catch {
        // keep as-is; validation below will catch
      }
    }

    const {
      expireSeconds,
      attachmentsMeta,
      attachmentsInline,
      chatRoomId: chatRoomIdRaw,
      roomId: roomIdRaw,
    } = body;

    const chatRoomId = Number(chatRoomIdRaw ?? roomIdRaw);
    if (!Number.isFinite(chatRoomId)) {
      throw Boom.badRequest('chatRoomId/roomId is required');
    }

    // Membership check with test fallback
    const okMember = await isMemberOrMemFallback(chatRoomId, senderId);
    if (!okMember) throw Boom.forbidden('Not a participant in this chat');

    // Clamp optional per-message TTL (5s .. 7d)
    let secs = Number(expireSeconds);
    secs = Number.isFinite(secs)
      ? Math.max(5, Math.min(7 * 24 * 60 * 60, secs))
      : undefined;

    // Parse upload meta
    let meta = [];
    try {
      meta = JSON.parse(attachmentsMeta || '[]');
      if (!Array.isArray(meta)) meta = [];
    } catch {
      meta = [];
    }

    const files = Array.isArray(req.files) ? req.files : [];

    // AV scan + derive attachments with PRIVATE paths
    const uploaded = [];
    for (let i = 0; i < files.length; i++) {
      const f = files[i];
      const m = meta.find((x) => Number(x.idx) === i) || {};
      const mime = f.mimetype || '';

      const av = await scanFile(f.path);
      if (!av.ok) {
        try {
          await fs.promises.unlink(f.path);
        } catch {}
        continue;
      }

      const relName = path.basename(f.path);
      const relPath = path.join('media', relName);

      const isImage = mime.startsWith('image/');
      let thumbRel = null;
      if (isImage) {
        try {
          const t = await ensureThumb(f.path, relName);
          thumbRel = t.rel;
        } catch {}
      }

      uploaded.push({
        kind: normalizeMediaKind(
          isImage
            ? 'IMAGE'
            : mime.startsWith('video/')
              ? 'VIDEO'
              : mime.startsWith('audio/')
                ? 'AUDIO'
                : 'FILE',
          mime
        ),
        url: relPath,
        mimeType: mime,
        width: m.width ?? null,
        height: m.height ?? null,
        durationSec: m.durationSec ?? null,
        caption: m.caption ?? null,
        thumbUrl: thumbRel ? path.join('thumbs', path.basename(thumbRel)) : null,
        _thumb: thumbRel,
        _fsPath: f.path,
      });
    }

    // Fill missing durationSec for audio
    for (const att of uploaded) {
      if (att.kind === 'AUDIO' && (att.durationSec == null || att.durationSec <= 0)) {
        const fsPath = att._fsPath || null;
        if (fsPath) {
          const dur = await probeDurationSec(fsPath);
          if (dur) att.durationSec = dur;
        }
      }
    }

    // Inline attachments (already uploaded elsewhere; just references)
    let inline = [];
    try {
      if (Array.isArray(attachmentsInline)) {
        inline = attachmentsInline;
      } else if (typeof attachmentsInline === 'string') {
        inline = JSON.parse(attachmentsInline || '[]');
      } else {
        inline = [];
      }
      if (!Array.isArray(inline)) inline = [];
    } catch {
      inline = [];
    }

    inline = inline
      .filter((a) => a && a.url && a.kind)
      .map((a) => ({
        kind: normalizeMediaKind(a.kind, a.mimeType),
        url: a.url,
        mimeType: a.mimeType || '',
        width: a.width ?? null,
        height: a.height ?? null,
        durationSec: a.durationSec ?? null,
        caption: a.caption ?? null,
        thumbUrl: a.thumbUrl ?? a.thumbnailUrl ?? null,
      }));

    // ✅ final combined attachments list
    const attachments = [...uploaded, ...inline].map((a) => ({
      kind: a.kind,
      url: a.url,
      mimeType: a.mimeType || '',
      width: a.width ?? null,
      height: a.height ?? null,
      durationSec: a.durationSec ?? null,
      caption: a.caption ?? null,
      thumbUrl: a.thumbUrl ?? null,
    }));

    // strict-E2EE gating
    const sender = await prisma.user.findUnique({
      where: { id: senderId },
      select: { strictE2EE: true },
    });
    const strict = !!sender?.strictE2EE;

    const hasAttachments = attachments.length > 0;
    const hasText = Boolean(content && String(content).trim());
    const hasSomeBody = hasText || hasAttachments;

    if (strict && hasSomeBody) {
      if (!contentCiphertext || typeof contentCiphertext !== 'string') {
        throw Boom.badRequest('contentCiphertext is required (Option A E2EE)');
      }
      if (!encryptedKeys || typeof encryptedKeys !== 'object' || Array.isArray(encryptedKeys)) {
        throw Boom.badRequest('encryptedKeys must be a JSON object map (Option A E2EE)');
      }
    }

    // ✅ Save via service (this is what triggers SMS fan-out)
    let saved;
    try {
      saved = await createMessageService({
        senderId,
        chatRoomId,
        clientMessageId,      // ✅ NEW (idempotency)
        content,
        contentCiphertext,    // can be string or object; service stringifies
        encryptedKeys,        // ✅ NEW (E2EE recipient keys -> MessageKey)
        expireSeconds: secs,
        attachments,
      });
    } catch (err) {
      console.error('[message create FAILED]', err);

      if (IS_TEST) {
        saved = memSaveMessage({
          chatRoomId,
          senderId,
          content,
          contentCiphertext,
          encryptedKeys,
          attachments,
        });
      } else {
        throw err;
      }
    }

    // Shape response with short-lived signed URLs
    const toSigned = (rel, ownerId) =>
      `/files?token=${encodeURIComponent(signDownloadToken({ path: rel, ownerId, ttlSec: 300 }))}`;

    const shaped = {
      ...saved,
      imageUrl: saved?.imageUrl ? toSigned(saved.imageUrl, senderId) : null,
      audioUrl: saved?.audioUrl ? toSigned(saved.audioUrl, senderId) : null,
      attachments: (saved?.attachments || []).map((a) => {
        const out = { ...a };
        out.url = a.url && !/^https?:\/\//i.test(a.url) ? toSigned(a.url, senderId) : a.url;
        if (out.thumbUrl && !/^https?:\/\//i.test(out.thumbUrl)) {
          out.thumbUrl = toSigned(out.thumbUrl, senderId);
        }
        return out;
      }),
    };

    emitMessageNew(chatRoomId, shaped);
    return res.status(201).json({ item: shaped });
  })
);

// POST /messages/:roomId/clear
router.post(
  '/:roomId/clear',
  requireAuth,
  asyncHandler(async (req, res) => {
    const userId = Number(req.user?.id);
    const roomId = Number(req.params.roomId);
    if (!Number.isFinite(roomId)) throw Boom.badRequest('Invalid roomId');

    // must be participant (or admin)
    const isAdmin = req.user?.role === 'ADMIN';
    if (!isAdmin) {
      const member = await prisma.participant.findFirst({
        where: { chatRoomId: roomId, userId },
        select: { id: true },
      });
      if (!member) throw Boom.forbidden('Forbidden');
    }

    const clearedAt = new Date();

    await prisma.threadClear.upsert({
      where: { userId_chatRoomId: { userId, chatRoomId: roomId } },
      update: { clearedAt },
      create: { userId, chatRoomId: roomId, clearedAt },
    });

    return res.status(201).json({ ok: true, clearedAt: clearedAt.toISOString() });
  })
);

// POST /messages/:roomId/clear-all
router.post(
  '/:roomId/clear-all',
  requireAuth,
  asyncHandler(async (req, res) => {
    const userId = Number(req.user?.id);
    const roomId = Number(req.params.roomId);
    if (!Number.isFinite(roomId)) throw Boom.badRequest('Invalid roomId');

    // must be participant (or admin)
    const isAdmin = req.user?.role === 'ADMIN';
    if (!isAdmin) {
      const member = await prisma.participant.findFirst({
        where: { chatRoomId: roomId, userId },
        select: { id: true },
      });
      if (!member) throw Boom.forbidden('Forbidden');
    }

    const now = new Date();

    // Tombstone ALL messages in this room
    await prisma.message.updateMany({
      where: { chatRoomId: roomId, deletedForAll: false },
      data: {
        deletedForAll: true,
        deletedAt: now,
        deletedById: userId, // adjust to your schema field name
        rawContent: '',
        content: '',
        translatedForMe: null,
        // If you store link preview fields, null them too:
        // linkPreview: Prisma.JsonNull,
      },
    });

    // If attachments are a relation/table, also mark them deleted (recommended)
    // await prisma.attachment.updateMany({ where: { message: { chatRoomId: roomId } }, data: { deletedAt: now } });

    // Optional: emit socket event so other clients tombstone instantly
    // io.to(String(roomId)).emit('thread_cleared_all', { roomId, deletedAt: now.toISOString(), deletedById: userId });

    return res.status(201).json({ ok: true, deletedAt: now.toISOString() });
  })
);

/**
 * PREMIUM: schedule a message to send later
 */
router.post(
  '/:roomId/schedule',
  requireAuth,
  requirePremium,
  asyncHandler(async (req, res) => {
    const senderId = Number(req.user?.id);
    const roomId = Number(req.params.roomId);
    const { content, scheduledAt } = req.body || {};

    if (!Number.isFinite(roomId)) throw Boom.badRequest('Invalid roomId');
    if (!content || typeof content !== 'string' || !content.trim()) {
      throw Boom.badRequest('content is required');
    }

    const membership = await prisma.participant.findFirst({
      where: { chatRoomId: roomId, userId: senderId },
      select: { id: true, archivedAt: true },
    });
    if (!membership) throw Boom.forbidden('Not a participant in this chat');

    const ts =
      typeof scheduledAt === 'string' || typeof scheduledAt === 'number'
        ? new Date(scheduledAt)
        : null;
    if (!ts || Number.isNaN(ts.getTime())) {
      throw Boom.badRequest('scheduledAt must be a valid ISO date or ms epoch');
    }
    const now = Date.now();
    if (ts.getTime() <= now + 5000) {
      throw Boom.badRequest('scheduledAt must be in the future (≥ 5s)');
    }

    const scheduled = await prisma.scheduledMessage.create({
      data: {
        chatRoomId: roomId,
        senderId,
        content: content.trim(),
        scheduledAt: ts,
      },
      select: {
        id: true,
        chatRoomId: true,
        senderId: true,
        content: true,
        scheduledAt: true,
        createdAt: true,
      },
    });

    return res.status(201).json({ ok: true, scheduled });
  })
);

/**
 * LIST messages in a room
 */
router.get('/:chatRoomId', requireAuth, async (req, res) => {
  const chatRoomId = Number(req.params.chatRoomId);
  const requesterId = Number(req.user?.id);
  const isAdmin = req.user?.role === 'ADMIN';

  try {
    if (!Number.isFinite(chatRoomId)) {
      return res.status(400).json({ error: 'Invalid chatRoomId' });
    }

    // ✅ FIX: membership must exist in outer scope
    let membership = null;

    if (!isAdmin) {
      membership = await prisma.participant.findFirst({
        where: { chatRoomId, userId: requesterId },
        select: { id: true, archivedAt: true, clearedAt: true  },
      });

      const okMember =
        membership || (IS_TEST && roomsMem?.members?.get(chatRoomId)?.has(requesterId));

      if (!okMember) {
        console.log('🔒 MESSAGES FORBIDDEN DEBUG', {
          requestedRoomId: chatRoomId,
          authedUserId: req.user?.id,
        });

        const p = await prisma.participant.findFirst({
          where: { chatRoomId: Number(chatRoomId), userId: Number(req.user?.id) },
          select: { id: true, userId: true, chatRoomId: true, role: true, archivedAt: true, clearedAt: true },
        });

        console.log('🔒 Participant lookup result:', p);

        return res.status(403).json({ error: 'Forbidden' });
      }
    } else {
      // Admin can read even without membership, but if they *are* a member we still want archivedAt
      membership = await prisma.participant.findFirst({
        where: { chatRoomId, userId: requesterId },
        select: { archivedAt: true, clearedAt: true  },
      });
    }

    // ✅ "Clear conversation" cutoff (Participant.archivedAt fallback)
  let clearedAt = membership?.archivedAt ?? null;

  // Test-mode fallback: roomsMem.clearedAt[roomId][userId]
  if (!clearedAt && IS_TEST) {
    const iso = roomsMem?.clearedAt?.get(chatRoomId)?.get(requesterId) || null;
    if (iso) {
      const d = new Date(iso);
      if (!Number.isNaN(d.getTime())) clearedAt = d;
    }
  }

  // ✅ ALSO honor threadClear table (this is what /:roomId/clear writes)
  const tc = await prisma.threadClear.findUnique({
    where: { userId_chatRoomId: { userId: requesterId, chatRoomId } },
    select: { clearedAt: true },
  });

  if (tc?.clearedAt) {
    const t = new Date(tc.clearedAt);
    if (!Number.isNaN(t.getTime())) {
      // if both exist, take the newest cutoff
      clearedAt = clearedAt
        ? new Date(Math.max(new Date(clearedAt).getTime(), t.getTime()))
        : t;
    }
  }

    const limitRaw = Number(req.query.limit ?? 50);
    const limit = Math.min(Math.max(1, limitRaw), 100);
    const cursorId = req.query.cursor ? Number(req.query.cursor) : null;

    const where = {
      chatRoomId,
      ...(clearedAt ? { createdAt: { gt: clearedAt } } : {}),
      OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
    };

    const baseSelect = {
      id: true,
      contentCiphertext: true,
      translations: true,
      translatedContent: true,
      translatedTo: true,
      imageUrl: true,
      audioUrl: true,
      audioDurationSec: true,
      isExplicit: true,
      createdAt: true,
      expiresAt: true,
      rawContent: true,

      // legacy (keep for compatibility while migrating)
      deletedBySender: true,

      // ✅ delete-for-all tombstone flags
      deletedForAll: true,
      deletedAt: true,
      deletedById: true,

      // ✅ edited marker
      editedAt: true,

      // ✅ delete-for-me marker (requires MessageDeletion model)
      deletions: {
        where: { userId: requesterId },
        select: { id: true },
        take: 1,
      },

      sender: { select: { id: true, username: true, publicKey: true } },
      readBy: { select: { id: true, username: true, avatarUrl: true } },
      attachments: {
        select: {
          id: true,
          kind: true,
          url: true,
          mimeType: true,
          width: true,
          height: true,
          durationSec: true,
          caption: true,
          thumbUrl: true,
          createdAt: true,
        },
      },
      keys: {
        where: { userId: requesterId },
        select: { encryptedKey: true },
        take: 1,
      },
      chatRoomId: true,
    };

    const items = await prisma.message.findMany({
      where: cursorId ? { ...where, id: { lt: cursorId } } : where,
      orderBy: { id: 'desc' },
      take: limit,
      select: baseSelect,
    });

    const messageIds = items.map((m) => m.id);

    let reactionSummaryByMessage = {};
    let myReactionsByMessage = {};

    if (messageIds.length) {
      const grouped = await prisma.messageReaction.groupBy({
        by: ['messageId', 'emoji'],
        where: { messageId: { in: messageIds } },
        _count: { emoji: true },
      });
      reactionSummaryByMessage = grouped.reduce((acc, r) => {
        (acc[r.messageId] ||= {})[r.emoji] = r._count.emoji;
        return acc;
      }, {});

      const mine = await prisma.messageReaction.findMany({
        where: { messageId: { in: messageIds }, userId: requesterId },
        select: { messageId: true, emoji: true },
      });
      myReactionsByMessage = mine.reduce((acc, r) => {
        (acc[r.messageId] ||= new Set()).add(r.emoji);
        return acc;
      }, {});
    }

    const requester = await prisma.user.findUnique({
      where: { id: requesterId },
      select: { preferredLanguage: true },
    });
    const myLang = requester?.preferredLanguage || 'en';

    const translationEnabled = process.env.TRANSLATION_ENABLED === 'true';
    const translatedForMeMap = new Map();

    // ✅ do not translate tombstones, and skip delete-for-me messages
    if (translationEnabled && items.length && myLang) {
      const jobs = items.map(async (m) => {
        if (m.deletions?.length) return;

        if (m.deletedForAll) {
          translatedForMeMap.set(m.id, null);
          return;
        }

        const preCached =
          m.translations && typeof m.translations === 'object'
            ? (m.translations[myLang] ?? null)
            : null;
        const legacy =
          m.translatedTo && m.translatedTo === myLang ? m.translatedContent : null;

        if (preCached || legacy) {
          translatedForMeMap.set(m.id, preCached || legacy || null);
          return;
        }

        const src = m.rawContent || '';
        if (!src.trim()) {
          translatedForMeMap.set(m.id, null);
          return;
        }

        try {
          const { translatedText } = await maybeTranslateForTarget(src, null, myLang);
          translatedForMeMap.set(m.id, translatedText || null);
        } catch {
          translatedForMeMap.set(m.id, null);
        }
      });

      await Promise.all(jobs);
    }

    const shapedDb = items
      .filter((m) => !(m.deletions?.length))
      .filter((m) => !(m.deletedBySender && m.sender.id === requesterId))
      .map((m) => {
        const isSender = m.sender.id === requesterId;

        const reactionSummary = reactionSummaryByMessage[m.id] || {};
        const myReactions = Array.from(myReactionsByMessage[m.id] || []);

        // ✅ Tombstone for delete-for-everyone
        if (m.deletedForAll) {
          return {
            id: m.id,
            chatRoomId: m.chatRoomId,
            createdAt: m.createdAt,
            expiresAt: m.expiresAt,
            sender: m.sender,
            readBy: m.readBy,

            deletedForAll: true,
            deletedAt: m.deletedAt,
            deletedById: m.deletedById,

            isExplicit: false,
            rawContent: null,
            contentCiphertext: null,
            attachments: [],

            encryptedKeyForMe: null,
            translatedForMe: null,
            reactionSummary,
            myReactions,

            editedAt: null,
          };
        }

        const preCached =
          m.translations && typeof m.translations === 'object'
            ? (m.translations[myLang] ?? null)
            : null;
        const legacy =
          m.translatedTo && m.translatedTo === myLang ? m.translatedContent : null;
        const live = translatedForMeMap.get(m.id) ?? null;
        const translatedForMe = preCached || legacy || live || null;

        const encryptedKeyForMe = m.keys?.[0]?.encryptedKey || null;

        const { translations, translatedContent, translatedTo, keys, deletions, ...rest } = m;

        const base = {
          ...rest,
          encryptedKeyForMe,
          translatedForMe,
          reactionSummary,
          myReactions,
        };

        // keep rawContent for plaintext messages so recipients can read them
        if (isSender || isAdmin) return base;

        // Only strip rawContent for encrypted messages
        if (m.contentCiphertext != null) {
          const { rawContent, ...restNoRaw } = base;
          return restNoRaw;
        }

        return base;
      });

    // ✅ test-mode in-memory messages: apply the same cutoff
    let memItems = [];
    if (IS_TEST && mem?.byRoom?.has(chatRoomId)) {
      const ids = mem.byRoom.get(chatRoomId);

      memItems = ids
        .map((id) => mem.byId.get(id))
        .filter(Boolean)
        .filter((m) => {
          if (!clearedAt) return true;
          const ts = new Date(m.createdAt);
          return !Number.isNaN(ts.getTime()) && ts > clearedAt;
        })
        .map((m) => ({
          id: m.id,
          chatRoomId: m.chatRoomId,
          rawContent: m.rawContent,
          contentCiphertext: m.contentCiphertext,
          isExplicit: false,
          createdAt: m.createdAt,
          sender: { id: m.senderId, username: `user${m.senderId}` },
          readBy: [],
          attachments: m.attachments || [],
          encryptedKeyForMe: null,
          translatedForMe: null,
          reactionSummary: {},
          myReactions: [],
          deletedForAll: m.deletedForAll || false,
          deletedAt: m.deletedAt || null,
          deletedById: m.deletedById || null,
          editedAt: m.editedAt || null,
        }));
    }

    const all = [...memItems, ...shapedDb]
      .sort((a, b) => b.id - a.id)
      .slice(0, limit);

    const nextCursor = all.length === limit ? all[all.length - 1].id : null;

    return res.json({ items: all, nextCursor, count: all.length });
  } catch (e) {
    console.error('[messages:list] failed', e);
    return res.status(500).json({ error: 'Failed to fetch messages' });
  }
});

// PATCH /messages/:id/read
router.patch(
  '/:id/read',
  requireAuth,
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const userId = Number(req.user?.id);
    if (!Number.isFinite(id)) throw Boom.badRequest('Invalid id');

    if (IS_TEST) {
      const mm = memGetMessage(id);
      if (mm) {
        if (!mm.readBy.includes(userId)) mm.readBy.push(userId);
        return res.json({ ok: true });
      }
    }

    const m = await prisma.message.findUnique({
      where: { id },
      select: { id: true, chatRoomId: true },
    });
    if (!m) throw Boom.notFound('Not found');

    const isMember = await prisma.participant.findFirst({
      where: { chatRoomId: m.chatRoomId, userId },
      select: { id: true },
    });
    if (!isMember) throw Boom.forbidden('Forbidden');

    await prisma.message.update({
      where: { id },
      data: { readBy: { connect: { id: userId } } },
      select: { id: true },
    });

    const io = req.app.get('io');
    io?.to(String(m.chatRoomId)).emit('message_read', {
      messageId: id,
      reader: { id: userId, username: req.user.username },
    });

    return res.json({ ok: true });
  })
);

// POST /messages/read-bulk
router.post(
  '/read-bulk',
  requireAuth,
  asyncHandler(async (req, res) => {
    const userId = Number(req.user?.id);
    const ids = (req.body?.ids || []).map(Number).filter(Number.isFinite);

    if (!ids.length) return res.json({ ok: true });

    if (IS_TEST) {
      for (const id of ids) {
        const mm = memGetMessage(id);
        if (mm && !mm.readBy.includes(userId)) mm.readBy.push(userId);
      }
      return res.json({ ok: true, count: ids.length });
    }

    const msgs = await prisma.message.findMany({
      where: { id: { in: ids } },
      select: { id: true, chatRoomId: true },
    });

    const rooms = [...new Set(msgs.map((m) => m.chatRoomId))];
    const allowed = await prisma.participant.findMany({
      where: { userId, chatRoomId: { in: rooms } },
      select: { chatRoomId: true },
    });
    const allowedSet = new Set(allowed.map((a) => a.chatRoomId));
    const allowedIds = msgs.filter((m) => allowedSet.has(m.chatRoomId)).map((m) => m.id);

    if (!allowedIds.length) return res.json({ ok: true });

    await prisma.$transaction(
      allowedIds.map((id) =>
        prisma.message.update({
          where: { id },
          data: { readBy: { connect: { id: userId } } },
          select: { id: true },
        })
      )
    );

    const io = req.app.get('io');
    for (const m of msgs.filter((m) => allowedIds.includes(m.id))) {
      io?.to(String(m.chatRoomId)).emit('message_read', {
        messageId: m.id,
        reader: { id: userId, username: req.user.username },
      });
    }

    return res.json({ ok: true, count: allowedIds.length });
  })
);

/**
 * REACTIONS
 */
router.post(
  '/:id/reactions',
  requireAuth,
  asyncHandler(async (req, res) => {
    const messageId = Number(req.params.id);
    const userId = Number(req.user?.id);
    const { emoji } = req.body || {};

    if (!emoji || typeof emoji !== 'string') throw Boom.badRequest('emoji is required');
    if (!Number.isFinite(messageId)) throw Boom.badRequest('Invalid id');

    if (IS_TEST && memGetMessage(messageId)) {
      return res.json({ ok: true, op: 'added', emoji, count: 1 });
    }

    const msg = await prisma.message.findUnique({
      where: { id: messageId },
      select: { chatRoomId: true, deletedForAll: true },
    });
    if (!msg) throw Boom.notFound('Not found');

    // ✅ optional: block reacting on tombstones
    if (msg.deletedForAll) return res.json({ ok: true, op: 'noop', emoji, count: 0 });

    const member = await prisma.participant.findFirst({
      where: { chatRoomId: msg.chatRoomId, userId },
    });
    if (!member) throw Boom.forbidden('Forbidden');

    const existing = await prisma.messageReaction.findUnique({
      where: { messageId_userId_emoji: { messageId, userId, emoji } },
    });

    if (existing) {
      await prisma.messageReaction.delete({
        where: { messageId_userId_emoji: { messageId, userId, emoji } },
      });
      const count = await prisma.messageReaction.count({ where: { messageId, emoji } });
      req.app.get('io')?.to(String(msg.chatRoomId)).emit('reaction_updated', {
        messageId,
        emoji,
        op: 'removed',
        user: { id: userId, username: req.user.username },
        count,
      });
      return res.json({ ok: true, op: 'removed', emoji, count });
    }

    await prisma.messageReaction.create({ data: { messageId, userId, emoji } });
    const count = await prisma.messageReaction.count({ where: { messageId, emoji } });
    req.app.get('io')?.to(String(msg.chatRoomId)).emit('reaction_updated', {
      messageId,
      emoji,
      op: 'added',
      user: { id: userId, username: req.user.username },
      count,
    });
    return res.json({ ok: true, op: 'added', emoji, count });
  })
);

router.delete(
  '/:id/reactions/:emoji',
  requireAuth,
  asyncHandler(async (req, res) => {
    const messageId = Number(req.params.id);
    if (!Number.isFinite(messageId)) throw Boom.badRequest('Invalid id');

    const userId = Number(req.user?.id);
    const emoji = decodeURIComponent(req.params.emoji || '');

    if (IS_TEST && memGetMessage(messageId)) {
      return res.json({ ok: true, op: 'removed', emoji });
    }

    await prisma.messageReaction
      .delete({
        where: { messageId_userId_emoji: { messageId, userId, emoji } },
      })
      .catch(() => {});

    const msg = await prisma.message.findUnique({
      where: { id: messageId },
      select: { chatRoomId: true },
    });

    if (msg) {
      const count = await prisma.messageReaction.count({ where: { messageId, emoji } });
      req.app.get('io')?.to(String(msg.chatRoomId)).emit('reaction_updated', {
        messageId,
        emoji,
        op: 'removed',
        user: { id: userId, username: req.user.username },
        count,
      });
    }

    return res.json({ ok: true, op: 'removed', emoji });
  })
);

/* =========================
 * EDIT (shared core + 2 routes)
 * ========================= */

async function editMessageCore(req, res) {
  const messageId = Number(req.params.id);
  const requesterId = Number(req.user?.id);
  const newContent = req.body?.newContent ?? req.body?.content;

  if (!Number.isFinite(messageId)) throw Boom.badRequest('Invalid id');
  if (!newContent || typeof newContent !== 'string') {
    throw Boom.badRequest('newContent is required');
  }

  if (IS_TEST) {
    const mm = memGetMessage(messageId);
    if (mm) {
      if (mm.senderId !== requesterId) throw Boom.forbidden('Unauthorized or already read');
      const someoneElseRead = (mm.readBy || []).some((uid) => uid !== requesterId);
      if (someoneElseRead) throw Boom.forbidden('Unauthorized or already read');
      if (mm.deletedForAll) throw Boom.forbidden('Cannot edit a deleted message');

      const updated = memEditMessage(messageId, newContent);

      req.app.get('io')?.to(String(mm.chatRoomId)).emit('message_edited', {
        messageId,
        rawContent: newContent,
        editedAt: updated.editedAt,
      });

      return res.json({
        id: updated.id,
        chatRoomId: updated.chatRoomId,
        sender: { id: requesterId, username: `user${requesterId}` },
        rawContent: updated.rawContent,
        editedAt: updated.editedAt,
      });
    }
  }

  const message = await prisma.message.findUnique({
    where: { id: messageId },
    select: {
      id: true,
      createdAt: true,
      rawContent: true,
      deletedForAll: true,
      chatRoomId: true,
      sender: { select: { id: true, username: true } },
      readBy: { select: { id: true } },
    },
  });
  if (!message) throw Boom.notFound('Message not found');
  if (message.deletedForAll) throw Boom.forbidden('Cannot edit a deleted message');

  const someoneElseRead = (message.readBy || []).some((u) => u.id !== requesterId);
  if (message.sender.id !== requesterId || someoneElseRead) {
    throw Boom.forbidden('Unauthorized or already read');
  }

  const windowSec = Number(process.env.MESSAGE_EDIT_WINDOW_SEC || 900);
  if (Number.isFinite(windowSec) && windowSec > 0) {
    const ageMs = Date.now() - new Date(message.createdAt).getTime();
    if (ageMs > windowSec * 1000) {
      const err = Boom.forbidden('Edit window expired');
      err.output.payload.code = 'EDIT_WINDOW_EXPIRED';
      err.output.payload.windowSec = windowSec;
      throw err;
    }
  }

  const updated = await prisma.message.update({
    where: { id: messageId },
    data: {
      rawContent: newContent,
      editedAt: new Date(), // ✅ requires schema
    },
    select: {
      id: true,
      chatRoomId: true,
      senderId: true,
      rawContent: true,
      createdAt: true,
      editedAt: true,
    },
  });

  req.app.get('io')?.to(String(updated.chatRoomId)).emit('message_edited', {
    messageId,
    rawContent: newContent,
    editedAt: updated.editedAt,
  });

  return res.json({
    id: updated.id,
    chatRoomId: updated.chatRoomId,
    sender: { id: requesterId, username: req.user.username },
    rawContent: updated.rawContent,
    editedAt: updated.editedAt,
  });
}

router.patch('/:id/edit', requireAuth, asyncHandler(editMessageCore));
router.patch('/:id', requireAuth, asyncHandler(editMessageCore));

/**
 * DELETE message
 * - scope=me  => per-user delete (MessageDeletion)
 * - scope=all => tombstone (deletedForAll)
 */
router.delete(
  '/:id',
  requireAuth,
  audit('messages.delete', {
    resource: 'message',
    resourceId: (req) => req.params.id,
  }),
  asyncHandler(async (req, res) => {
    const messageId = Number(req.params.id);
    const requesterId = Number(req.user?.id);
    const isAdmin = req.user?.role === 'ADMIN';
    const scope = String(
      req.query.scope || req.query.mode || req.body?.scope || req.body?.mode || 'me'
    );

    if (!Number.isFinite(messageId)) throw Boom.badRequest('Invalid id');

    // ---- TEST MEMORY MODE ----
    if (IS_TEST) {
      const mm = memGetMessage(messageId);
      if (!mm) throw Boom.notFound('Message not found');

      if (scope === 'all') {
        if (!isAdmin && mm.senderId !== requesterId) {
          throw Boom.forbidden('Unauthorized to delete for everyone');
        }

        // idempotent
        if (mm.deletedForAll) return res.json({ success: true, scope: 'all' });

        mm.deletedForAll = true;
        mm.deletedAt = new Date().toISOString();
        mm.deletedById = requesterId;
        mm.rawContent = null;
        mm.contentCiphertext = null;
        mm.attachments = [];

        req.app.get('io')?.to(String(mm.chatRoomId)).emit('message_deleted', {
          messageId,
          chatRoomId: mm.chatRoomId,
          scope: 'all',
          deletedAt: mm.deletedAt,
          deletedById: requesterId,
        });

        return res.json({ success: true, scope: 'all' });
      }

      // delete-for-me in mem: remove (fine for tests)
      mem.byId.delete(messageId);
      const arr = mem.byRoom.get(mm.chatRoomId) || [];
      mem.byRoom.set(mm.chatRoomId, arr.filter((id) => id !== messageId));

      req.app.get('io')?.to(String(mm.chatRoomId)).emit('message_deleted', {
        messageId,
        chatRoomId: mm.chatRoomId,
        scope: 'me',
        userId: requesterId,
      });

      return res.json({ success: true, scope: 'me' });
    }

    const message = await prisma.message.findUnique({
      where: { id: messageId },
      select: { id: true, senderId: true, chatRoomId: true, deletedForAll: true },
    });
    if (!message) throw Boom.notFound('Message not found');

    // must be a participant to delete for-me (prevents random deletes)
    const member = await prisma.participant.findFirst({
      where: { chatRoomId: message.chatRoomId, userId: requesterId },
      select: { id: true },
    });
    if (!member && !isAdmin) throw Boom.forbidden('Forbidden');

    // delete for everyone
    if (scope === 'all') {
      if (!isAdmin && message.senderId !== requesterId) {
        throw Boom.forbidden('Unauthorized to delete for everyone');
      }

      // ✅ idempotent guard
      if (message.deletedForAll) {
        return res.json({ success: true, scope: 'all' });
      }

      const deletedAt = new Date();

      await prisma.message.update({
        where: { id: messageId },
        data: {
          deletedForAll: true,
          deletedAt,
          deletedById: requesterId,
          rawContent: null,
          translatedContent: null,
          translations: null,
          contentCiphertext: null,
        },
      });

      req.app.get('io')?.to(String(message.chatRoomId)).emit('message_deleted', {
        messageId,
        chatRoomId: message.chatRoomId,
        scope: 'all',
        deletedAt: deletedAt.toISOString(),
        deletedById: requesterId,
      });

      return res.json({ success: true, scope: 'all' });
    }

    // delete for me (per-user)
    await prisma.messageDeletion.upsert({
      where: { messageId_userId: { messageId, userId: requesterId } },
      update: {},
      create: { messageId, userId: requesterId },
    });

    req.app.get('io')?.to(String(message.chatRoomId)).emit('message_deleted', {
      messageId,
      chatRoomId: message.chatRoomId,
      scope: 'me',
      userId: requesterId,
    });

    return res.json({ success: true, scope: 'me' });
  })
);

/**
 * Report a message (user forwards decrypted content to admin)
 */
router.post(
  '/report',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { messageId, decryptedContent } = req.body || {};
    const reporterId = Number(req.user?.id);

    if (!messageId || !decryptedContent) {
      throw Boom.badRequest('messageId and decryptedContent are required');
    }

    if (IS_TEST && memGetMessage(Number(messageId))) {
      return res.status(201).json({ success: true });
    }

    await prisma.report.create({
      data: {
        messageId: Number(messageId),
        reporterId: Number(reporterId),
        decryptedContent,
      },
    });

    return res.status(201).json({ success: true });
  })
);

/**
 * FORWARD a message to another room (reuses attachments)
 */
router.post(
  '/:id/forward',
  requireAuth,
  asyncHandler(async (req, res) => {
    const srcId = Number(req.params.id);
    const { toRoomId, note } = req.body || {};
    const userId = Number(req.user?.id);

    if (!Number.isFinite(srcId)) throw Boom.badRequest('Invalid id');
    if (!toRoomId) throw Boom.badRequest('toRoomId is required');

    if (IS_TEST) {
      const srcMem = memGetMessage(srcId);
      if (srcMem) {
        const saved = memSaveMessage({
          chatRoomId: Number(toRoomId),
          senderId: userId,
          content: note || '(forwarded)',
          attachments: srcMem.attachments || [],
        });
        req.app.get('io')?.to(String(toRoomId)).emit('receive_message', saved);
        return res.json(saved);
      }
    }

    const src = await prisma.message.findUnique({
      where: { id: srcId },
      include: { chatRoom: { select: { id: true } }, attachments: true },
    });
    if (!src) throw Boom.notFound('Not found');

    const [inSrc, inDst] = await Promise.all([
      prisma.participant.findFirst({ where: { chatRoomId: src.chatRoomId, userId } }),
      prisma.participant.findFirst({ where: { chatRoomId: Number(toRoomId), userId } }),
    ]);
    if (!inSrc || !inDst) throw Boom.forbidden('Forbidden');

    const saved = await prisma.message.create({
      data: {
        sender: { connect: { id: userId } },
        chatRoomId: Number(toRoomId),
        rawContent: note || '(forwarded)',
        attachments: src.attachments.length
          ? {
              createMany: {
                data: src.attachments.map((a) => ({
                  kind: a.kind,
                  url: a.url,
                  mimeType: a.mimeType,
                  width: a.width,
                  height: a.height,
                  durationSec: a.durationSec,
                  caption: a.caption,
                  thumbUrl: a.thumbUrl ?? null,
                })),
              },
            }
          : undefined,
      },
      include: { attachments: true },
    });

    req.app.get('io')?.to(String(toRoomId)).emit('receive_message', saved);
    return res.json(saved);
  })
);

export default router;
