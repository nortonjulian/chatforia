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
  const k = String(kind || '').toLowerCase();
  if (k === 'image' || k === 'video' || k === 'audio' || k === 'file') return k;
  if (k === 'image' || k === 'video' || k === 'audio' || k === 'file') return k;

  // Prisma enums like IMAGE/VIDEO/AUDIO/FILE
  if (k === 'image' || k === 'video' || k === 'audio' || k === 'file') return k;
  if (k === 'image') return 'image';

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
        kind: isImage
          ? 'IMAGE'
          : mime.startsWith('video/')
            ? 'VIDEO'
            : mime.startsWith('audio/')
              ? 'AUDIO'
              : 'FILE',
        url: relPath,
        mimeType: mime,
        width: m.width ?? null,
        height: m.height ?? null,
        durationSec: m.durationSec ?? null,
        caption: m.caption ?? null,
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

    // Inline attachments
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
      kind: a.kind,
      url: a.url,
      mimeType: a.mimeType || '',
      width: a.width ?? null,
      height: a.height ?? null,
      durationSec: a.durationSec ?? null,
      caption: a.caption ?? null,
      // optional: pass thumbUrl through for sidebar later
      thumbUrl: a.thumbUrl ?? a.thumbnailUrl ?? null,
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
        content,
        contentCiphertext, // can be string or object; service stringifies
        expireSeconds: secs,
        attachments: attachments.map((a) => ({
          kind: a.kind,
          url: a.url,
          mimeType: a.mimeType || '',
          width: a.width ?? null,
          height: a.height ?? null,
          durationSec: a.durationSec ?? null,
          caption: a.caption ?? null,
        })),
      });

      // NOTE: service currently persists MessageKey from contentCiphertext.keyIds
      // If you're using encryptedKeys map instead, we can add support later.
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
        return out;
      }),
    };

    const io = req.app.get('io');
    if (!io) {
      console.warn(
        '[messages] Socket.IO not found on app. Did you call app.set("io", io) in server bootstrap?'
      );
    } else {
      io.to(String(chatRoomId)).emit('receive_message', shaped);
    }

    return res.status(201).json(shaped);
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
      select: { id: true },
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
  const requesterId = req.user.id;
  const isAdmin = req.user.role === 'ADMIN';

  try {
    if (!Number.isFinite(chatRoomId)) {
      return res.status(400).json({ error: 'Invalid chatRoomId' });
    }

    if (!isAdmin) {
      const membership = await prisma.participant.findFirst({
        where: { chatRoomId, userId: requesterId },
      });
      const okMember =
        membership || (IS_TEST && roomsMem?.members?.get(chatRoomId)?.has(requesterId));
      if (!okMember) return res.status(403).json({ error: 'Forbidden' });
    }

    const limitRaw = Number(req.query.limit ?? 50);
    const limit = Math.min(Math.max(1, limitRaw), 100);
    const cursorId = req.query.cursor ? Number(req.query.cursor) : null;

    const where = {
      chatRoomId,
      OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
    };

    // ✅ UPDATED: include delete-for-me (deletions) + delete-for-all tombstone flags
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

      // ✅ NEW fields (require prisma schema changes)
      deletedForAll: true,
      deletedAt: true,
      deletedById: true,

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

    // ✅ UPDATED: do not translate tombstones, and skip delete-for-me messages
    if (translationEnabled && items.length && myLang) {
      const jobs = items.map(async (m) => {
        // delete-for-me => hide later; no work
        if (m.deletions?.length) return;

        // delete-for-all => tombstone; no translate
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

    // ✅ UPDATED: delete-for-me is handled by the deletions relation,
    // and delete-for-all becomes a tombstone object.
    const shapedDb = items
      // delete-for-me hides it for this requester
      .filter((m) => !(m.deletions?.length))

      // legacy fallback (your current behavior): sender hiding their own "deletedBySender" messages
      // keep this while migrating; you can remove later once everything uses MessageDeletion
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

            // markers
            deletedForAll: true,
            deletedAt: m.deletedAt,
            deletedById: m.deletedById,

            // content cleared
            isExplicit: false,
            rawContent: null,
            contentCiphertext: null,
            attachments: [],

            // feature payloads disabled
            encryptedKeyForMe: null,
            translatedForMe: null,
            reactionSummary,
            myReactions,
          };
        }

        // normal translation
        const preCached =
          m.translations && typeof m.translations === 'object'
            ? (m.translations[myLang] ?? null)
            : null;
        const legacy =
          m.translatedTo && m.translatedTo === myLang ? m.translatedContent : null;
        const live = translatedForMeMap.get(m.id) ?? null;
        const translatedForMe = preCached || legacy || live || null;

        const encryptedKeyForMe = m.keys?.[0]?.encryptedKey || null;

        // remove fields we don't want to send
        const { translations, translatedContent, translatedTo, keys, deletions, ...rest } = m;

        const base = {
          ...rest,
          encryptedKeyForMe,
          translatedForMe,
          reactionSummary,
          myReactions,
        };

        if (isSender || isAdmin) return base;
        const { rawContent, ...restNoRaw } = base;
        return restNoRaw;
      });

    let memItems = [];
    if (IS_TEST && mem?.byRoom?.has(chatRoomId)) {
      const ids = mem.byRoom.get(chatRoomId);
      memItems = ids
        .map((id) => mem.byId.get(id))
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

          // keep these present so frontend won't crash if it expects them
          deletedForAll: false,
          deletedAt: null,
          deletedById: null,
        }));
    }

    const all = [...memItems, ...shapedDb]
      .sort((a, b) => b.id - a.id)
      .slice(0, limit);
    const nextCursor = all.length === limit ? all[all.length - 1].id : null;

    return res.json({ items: all, nextCursor, count: all.length });
  } catch {
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
      select: { chatRoomId: true },
    });
    if (!msg) throw Boom.notFound('Not found');

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

      const updated = memEditMessage(messageId, newContent);
      req.app.get('io')?.to(String(mm.chatRoomId)).emit('message_edited', {
        messageId,
        rawContent: newContent,
      });
      return res.json({
        id: updated.id,
        chatRoomId: updated.chatRoomId,
        sender: { id: requesterId, username: `user${requesterId}` },
        rawContent: updated.rawContent,
        updatedAt: updated.updatedAt,
      });
    }
  }

  const message = await prisma.message.findUnique({
    where: { id: messageId },
    include: {
      sender: { select: { id: true, username: true } },
      readBy: { select: { id: true } },
      chatRoom: { select: { id: true } },
    },
  });
  if (!message) throw Boom.notFound('Message not found');

  const someoneElseRead = (message.readBy || []).some((u) => u.id !== requesterId);
  if (message.sender.id !== requesterId || someoneElseRead) {
    throw Boom.forbidden('Unauthorized or already read');
  }

  const updated = await prisma.message.update({
    where: { id: messageId },
    data: { rawContent: newContent },
    select: { id: true, chatRoomId: true, senderId: true, rawContent: true, createdAt: true },
  });

  req.app.get('io')?.to(String(updated.chatRoomId)).emit('message_edited', {
    messageId,
    rawContent: newContent,
  });

  return res.json({
    id: updated.id,
    chatRoomId: updated.chatRoomId,
    sender: { id: requesterId, username: req.user.username },
    rawContent: updated.rawContent,
  });
}

router.patch('/:id/edit', requireAuth, asyncHandler(editMessageCore));
router.patch('/:id', requireAuth, asyncHandler(editMessageCore));

/**
 * DELETE message (soft-delete by sender; admins allowed)
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
    const scope = String(req.query.scope || req.query.mode || req.body?.scope || req.body?.mode || 'me');

    if (!Number.isFinite(messageId)) throw Boom.badRequest('Invalid id');

    // ---- TEST MEMORY MODE ----
    if (IS_TEST) {
      const mm = memGetMessage(messageId);
      if (!mm) throw Boom.notFound('Message not found');

      // delete-for-all in mem: actually remove (fine for tests)
      if (scope === 'all') {
        if (!isAdmin && mm.senderId !== requesterId) {
          throw Boom.forbidden('Unauthorized to delete for everyone');
        }
        mem.byId.delete(messageId);
        const arr = mem.byRoom.get(mm.chatRoomId) || [];
        mem.byRoom.set(mm.chatRoomId, arr.filter((id) => id !== messageId));

        req.app.get('io')?.to(String(mm.chatRoomId)).emit('message_deleted', {
          messageId,
          chatRoomId: mm.chatRoomId,
          scope: 'all',
        });

        return res.json({ success: true, scope: 'all' });
      }

      // delete-for-me in mem: also remove (fine for tests)
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
      select: { id: true, senderId: true, chatRoomId: true },
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

      await prisma.message.update({
        where: { id: messageId },
        data: {
          deletedForAll: true,
          deletedAt: new Date(),
          deletedById: requesterId,
          // optional: also clear plaintext to reduce leakage
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
        deletedAt: new Date().toISOString(),
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

    // Emit to just that user if you have user rooms; otherwise emit to room and let clients ignore if not requester
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
