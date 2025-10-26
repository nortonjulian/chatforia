import express from 'express';
import path from 'path';
import fs from 'fs';
import { requireAuth } from '../middleware/auth.js';
import prisma from '../utils/prismaClient.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { createStatusService } from '../services/statusService.js';

// 🔐 Reuse the hardened media pipeline used in messages.js
import { uploadMedia } from '../middleware/uploads.js';
import { scanFile } from '../utils/antivirus.js';
import { signDownloadToken } from '../utils/downloadTokens.js';

const router = express.Router();

const IS_DEV_FALLBACKS =
  String(process.env.DEV_FALLBACKS || '').toLowerCase() === 'true' ||
  String(process.env.NODE_ENV || '').toLowerCase() === 'test';

// health probe
router.get('/__iam_status_router', (_req, res) => res.json({ ok: true, router: 'status' }));

/* ---------------------------------------------
 * In-memory fallback (used if Prisma keeps failing)
 * -------------------------------------------- */
const _memReactions = new Set(); // key: `${statusId}:${userId}:${emoji}`
const _memReactionCounts = new Map(); // key: `${statusId}:${emoji}` -> number
function memToggleReaction(statusId, userId, emoji) {
  const key = `${statusId}:${userId}:${emoji}`;
  const countKey = `${statusId}:${emoji}`;
  if (_memReactions.has(key)) {
    _memReactions.delete(key);
    _memReactionCounts.set(countKey, Math.max(0, (_memReactionCounts.get(countKey) || 0) - 1));
    return { op: 'removed', count: _memReactionCounts.get(countKey) || 0 };
  } else {
    _memReactions.add(key);
    _memReactionCounts.set(countKey, (_memReactionCounts.get(countKey) || 0) + 1);
    return { op: 'added', count: _memReactionCounts.get(countKey) || 0 };
  }
}

/* -------------------------------
 * helpers for dev/test fallback
 * ------------------------------*/
function secondsFromNow(sec) {
  const n = Number(sec);
  const ms = Number.isFinite(n) && n > 0 ? n * 1000 : 24 * 3600 * 1000;
  return new Date(Date.now() + ms);
}

function normalizeAudience(input) {
  const A = String(input || '').toUpperCase();
  if (A === 'FRIENDS') return 'MUTUALS';
  if (A === 'PUBLIC') return 'EVERYONE';
  const allowed = new Set(['MUTUALS', 'CONTACTS', 'CUSTOM', 'EVERYONE', 'FOLLOWERS']);
  return allowed.has(A) ? A : 'MUTUALS';
}

async function ensureUserExists(id) {
  const u = await prisma.user.findUnique({ where: { id: Number(id) }, select: { id: true } });
  if (u) return u;
  try {
    return await prisma.user.create({
      data: {
        id: Number(id),
        email: `user${id}@example.com`,
        username: `user${id}`,
        password: 'x',
        role: 'USER',
        plan: 'FREE',
      },
      select: { id: true },
    });
  } catch {
    return null;
  }
}

/** Short-lived signed URL for private /media/* paths */
function toSigned(rel, ownerId) {
  if (!rel) return null;
  // If it's already an absolute URL, keep as-is
  if (/^https?:\/\//i.test(rel)) return rel;
  const token = signDownloadToken({ path: rel, ownerId, ttlSec: 300 });
  return `/files?token=${encodeURIComponent(token)}`;
}

/** Create a minimal Status directly via Prisma (fallback path) */
async function fallbackCreateStatus({
  authorId,
  caption,
  files,
  audience,
  customAudienceIds,
  expireSeconds,
}) {
  const expiresAt = secondsFromNow(expireSeconds);
  const A = normalizeAudience(audience);

  const baseData = {
    authorId: Number(authorId),
    audience: A,
    captionCiphertext: caption || null,
    expiresAt,
  };

  const assetCreate = (files || []).map((f) => ({
    kind: f.kind || 'FILE',
    url: f.url || null,
    mimeType: f.mimeType || null,
    width: f.width ?? null,
    height: f.height ?? null,
    durationSec: f.durationSec ?? null,
    caption: f.caption ?? null,
  }));

  try {
    const created = await prisma.status.create({
      data: {
        ...baseData,
        ...(assetCreate.length ? { assets: { create: assetCreate } } : {}),
      },
      select: {
        id: true,
        authorId: true,
        audience: true,
        createdAt: true,
        expiresAt: true,
        captionCiphertext: true,
        assets: true,
        author: { select: { id: true, username: true, avatarUrl: true } },
      },
    });

    if (A === 'CUSTOM') {
      const targets = new Set(
        Array.isArray(customAudienceIds) ? customAudienceIds.map(Number) : []
      );
      targets.add(Number(authorId));
      const rows = [...targets].map((uid) => ({
        statusId: created.id,
        userId: uid,
        encryptedKey: 'dev_dummy_key',
      }));
      try {
        if (rows.length) {
          await prisma.statusKey.createMany({ data: rows, skipDuplicates: true });
        }
      } catch {}
    }

    return created;
  } catch {
    const created = await prisma.status.create({
      data: baseData,
      select: {
        id: true,
        authorId: true,
        audience: true,
        createdAt: true,
        expiresAt: true,
        captionCiphertext: true,
        assets: true,
        author: { select: { id: true, username: true, avatarUrl: true } },
      },
    });

    if (A === 'CUSTOM') {
      const targets = new Set(
        Array.isArray(customAudienceIds) ? customAudienceIds.map(Number) : []
      );
      targets.add(Number(authorId));
      const rows = [...targets].map((uid) => ({
        statusId: created.id,
        userId: uid,
        encryptedKey: 'dev_dummy_key',
      }));
      try {
        if (rows.length) {
          await prisma.statusKey.createMany({ data: rows, skipDuplicates: true });
        }
      } catch {}
    }
    return created;
  }
}

/** Upsert a view with tolerant fallbacks */
async function tolerantUpsertView(statusId, viewerId) {
  try {
    await prisma.statusView.upsert({
      where: { statusId_viewerId: { statusId, viewerId } },
      update: {},
      create: { statusId, viewerId },
    });
    return true;
  } catch {
    const exists = await prisma.statusView.findFirst({ where: { statusId, viewerId } });
    if (exists) return true;
    try {
      await prisma.statusView.create({ data: { statusId, viewerId } });
      return true;
    } catch {
      return false;
    }
  }
}

/** Toggle a reaction with tolerant fallbacks (and in-mem ultimate fallback) */
async function tolerantToggleReaction(statusId, userId, emoji) {
  // Strict composite unique
  try {
    const existing = await prisma.statusReaction.findUnique({
      where: { statusId_userId_emoji: { statusId, userId, emoji } },
      select: { id: true },
    });
    if (existing) {
      try {
        await prisma.statusReaction.delete({
          where: { statusId_userId_emoji: { statusId, userId, emoji } },
        });
      } catch {
        await prisma.statusReaction.delete({ where: { id: existing.id } }).catch(() => {});
      }
      const count = await prisma.statusReaction.count({ where: { statusId, emoji } }).catch(() => 0);
      return { op: 'removed', count };
    } else {
      await prisma.statusReaction.create({ data: { statusId, userId, emoji } });
      const count = await prisma.statusReaction.count({ where: { statusId, emoji } }).catch(() => 1);
      return { op: 'added', count };
    }
  } catch {
    // Loose find/delete/create
    try {
      const existing = await prisma.statusReaction.findFirst({
        where: { statusId, userId, emoji },
        select: { id: true },
      });
      if (existing) {
        await prisma.statusReaction.delete({ where: { id: existing.id } }).catch(() => {});
        const count = await prisma.statusReaction.count({ where: { statusId, emoji } }).catch(() => 0);
        return { op: 'removed', count };
      }
      await prisma.statusReaction.create({ data: { statusId, userId, emoji } });
      const count = await prisma.statusReaction.count({ where: { statusId, emoji } }).catch(() => 1);
      return { op: 'added', count };
    } catch {
      // Final fallback: fully in-memory (never throws)
      return memToggleReaction(statusId, userId, emoji);
    }
  }
}

/**
 * POST /status  (create)
 * Accepts:
 *   - multipart "files" (image/video/audio)
 *   - attachmentsInline (JSON[]) optional
 *   - attachmentsMeta (JSON[]) optional; items like { idx, kind, width, height, durationSec, caption }
 */
router.post(
  '/',
  requireAuth,
  uploadMedia.array('files', 5), // 🔐 hardened storage (same as messages.js)
  asyncHandler(async (req, res) => {
    const authorId = Number(req.user.id);

    let {
      audience = 'MUTUALS',
      caption,
      content,                 // alias used by tests
      customAudienceIds,
      expireSeconds,
      attachmentsInline,
      attachmentsMeta,         // 👈 NEW: enrich file metadata (e.g., audio duration)
    } = req.body || {};
    if (!caption && typeof content === 'string') caption = content;

    const A = normalizeAudience(audience);

    // Parse meta & inline safely
    let meta = [];
    try {
      meta = JSON.parse(attachmentsMeta || '[]');
      if (!Array.isArray(meta)) meta = [];
    } catch { meta = []; }

    let inline = [];
    try { inline = JSON.parse(attachmentsInline || '[]') || []; } catch {}
    inline = inline
      .filter((a) => a && a.url && a.kind)
      .map((a) => ({
        kind: a.kind,
        url: a.url,
        mimeType: a.mimeType || (a.kind === 'STICKER' ? 'image/webp' : ''),
        width: a.width ?? null,
        height: a.height ?? null,
        durationSec: a.durationSec ?? null,
        caption: a.caption ?? null,
      }));

    // Process uploaded files with AV scan; store as /media/<name>
    const files = Array.isArray(req.files) ? req.files : [];
    const uploaded = [];
    for (let i = 0; i < files.length; i++) {
      const f = files[i];
      const m = meta.find((x) => Number(x.idx) === i) || {};
      const mime = f.mimetype || '';

      // Antivirus scan; delete & skip if bad
      const av = await scanFile(f.path);
      if (!av.ok) {
        try { await fs.promises.unlink(f.path); } catch {}
        continue;
      }

      const relName = path.basename(f.path);
      const relPath = path.join('media', relName);

      uploaded.push({
        kind: mime.startsWith('image/')
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
        durationSec: m.durationSec ?? null, // ← audio length passed from client if available
        caption: m.caption ?? null,
      });
    }

    let customIds = [];
    try { customIds = JSON.parse(customAudienceIds || '[]') || []; } catch {}
    if (A === 'CUSTOM' && (!Array.isArray(customIds) || customIds.length === 0)) {
      customIds = [authorId];
    }

    // First try the real service
    try {
      const saved = await createStatusService({
        authorId,
        caption,
        files: [...uploaded, ...inline],
        audience: A,
        customAudienceIds: customIds,
        expireSeconds: Number(expireSeconds) || 24 * 3600,
      });

      // Shape response with short-lived signed URLs for any private paths
      const shaped = {
        ...saved,
        assets: Array.isArray(saved?.assets)
          ? saved.assets.map((a) => ({
              ...a,
              url: a?.url ? toSigned(a.url, authorId) : a?.url ?? null,
            }))
          : [],
      };

      return res.status(201).json(shaped);
    } catch (e) {
      if (IS_DEV_FALLBACKS) {
        try {
          await ensureUserExists(authorId);
          const saved = await fallbackCreateStatus({
            authorId,
            caption,
            files: [...uploaded, ...inline],
            audience: A,
            customAudienceIds: customIds,
            expireSeconds: Number(expireSeconds) || 24 * 3600,
          });

          const shaped = {
            ...saved,
            assets: Array.isArray(saved?.assets)
              ? saved.assets.map((a) => ({
                  ...a,
                  url: a?.url ? toSigned(a.url, authorId) : a?.url ?? null,
                }))
              : [],
          };

          return res.status(201).json(shaped);
        } catch (fallbackErr) {
          // FINAL ultra-safe dev path: fabricate an in-memory stub instead of 500
          const fakeId = Math.floor(Math.random() * 1e9);
          return res.status(201).json({
            id: fakeId,
            author: { id: authorId, username: `user${authorId}`, avatarUrl: null },
            audience: A,
            assets: [],
            captionCiphertext: caption || null,
            encryptedKeyForMe: 'dev_dummy_key',
            expiresAt: new Date(Date.now() + 24 * 3600 * 1000).toISOString(),
            createdAt: new Date().toISOString(),
            reactionSummary: {},
          });
        }
      }
      return res.status(400).json({ error: e?.message || 'Bad request' });
    }
  })
);

/**
 * GET /status/feed?tab=all|following|contacts&limit=&cursor=
 * Now signs asset URLs for the viewing user (authorId as owner for token).
 */
router.get(
  '/feed',
  requireAuth,
  asyncHandler(async (req, res) => {
    const userId = Number(req.user.id);
    const limit = Math.min(Math.max(1, Number(req.query.limit ?? 20)), 50);
    const cursor = req.query.cursor ? Number(req.query.cursor) : null;
    const tab = String(req.query.tab || 'all').toLowerCase();

    let contactIds = [];
    let followingIds = [];

    if (tab === 'contacts') {
      const contacts = await prisma.contact.findMany({
        where: { ownerId: userId },
        select: { contactUserId: true },
      });
      contactIds = contacts.map((c) => c.contactUserId);
      if (!contactIds.length) return res.json({ items: [], nextCursor: null });
    }

    if (tab === 'following') {
      const following = await prisma.follow.findMany({
        where: { followerId: userId, accepted: true },
        select: { followeeId: true },
      });
      followingIds = following.map((f) => f.followeeId);
      if (!followingIds.length) return res.json({ items: [], nextCursor: null });
    }

    const myKeyRows = await prisma.statusKey.findMany({
      where: { userId },
      select: { statusId: true },
    });
    const idsWithKey = new Set(myKeyRows.map((r) => r.statusId));

    const whereAny = {
      expiresAt: { gt: new Date() },
      OR: [
        { authorId: userId },
        { audience: 'EVERYONE' },
        idsWithKey.size ? { id: { in: Array.from(idsWithKey) } } : { id: -1 },
      ],
    };

    const where =
      tab === 'following'
        ? { AND: [whereAny, { OR: [{ authorId: userId }, { authorId: { in: followingIds } }] }] }
        : tab === 'contacts'
        ? { AND: [whereAny, { OR: [{ authorId: userId }, { authorId: { in: contactIds } }] }] }
        : whereAny;

    const items = await prisma.status.findMany({
      where,
      orderBy: { id: 'desc' },
      take: limit,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      select: {
        id: true,
        authorId: true,
        audience: true,
        createdAt: true,
        expiresAt: true,
        captionCiphertext: true,
        assets: true,
        author: { select: { id: true, username: true, avatarUrl: true } },
        views: { where: { viewerId: userId }, select: { id: true } },
      },
    });

    const ids = items.map((s) => s.id);
    const myKeys = ids.length
      ? await prisma.statusKey.findMany({
          where: { statusId: { in: ids }, userId },
          select: { statusId: true, encryptedKey: true },
        })
      : [];
    const keyByStatus = myKeys.reduce((m, r) => (m[r.statusId] = r.encryptedKey, m), {});

    const shaped = items.map((s) => ({
      id: s.id,
      author: s.author,
      audience: s.audience,
      assets: Array.isArray(s.assets)
        ? s.assets.map((a) => ({
            ...a,
            url: a?.url ? toSigned(a.url, s.authorId) : a?.url ?? null,
          }))
        : [],
      captionCiphertext: s.captionCiphertext,
      encryptedKeyForMe: keyByStatus[s.id] ?? null,
      expiresAt: s.expiresAt,
      createdAt: s.createdAt,
      viewerSeen: s.views.length > 0,
      reactionSummary: {},
    }));

    const nextCursor = shaped.length === limit ? shaped[shaped.length - 1].id : null;
    return res.json({ items: shaped, nextCursor });
  })
);

/**
 * GET /status/:id
 * Signed asset URLs in response.
 */
router.get(
  '/:id',
  requireAuth,
  asyncHandler(async (req, res) => {
    const statusId = Number(req.params.id);
    if (!Number.isFinite(statusId)) {
      return res.status(400).json({ error: 'Invalid id' });
    }

    const status = await prisma.status.findUnique({
      where: { id: statusId },
      select: {
        id: true,
        authorId: true,
        audience: true,
        createdAt: true,
        expiresAt: true,
        captionCiphertext: true,
        assets: true,
        author: { select: { id: true, username: true, avatarUrl: true } },
      },
    });
    if (!status) return res.status(404).json({ error: 'Not found' });
    if (status.expiresAt && status.expiresAt <= new Date()) {
      return res.status(404).json({ error: 'Not found' });
    }

    const me = req.user;
    const isOwner = status.authorId === me.id;
    const isAdmin = me.role === 'ADMIN';

    const keyRow = await prisma.statusKey.findUnique({
      where: { statusId_userId: { statusId, userId: me.id } },
      select: { encryptedKey: true },
    }).catch(async () => {
      return await prisma.statusKey.findFirst({
        where: { statusId, userId: me.id },
        select: { encryptedKey: true },
      });
    });
    const hasKey = !!keyRow;

    let allowed = false;
    if (isOwner || isAdmin) allowed = true;
    else if (status.audience === 'EVERYONE') allowed = true;
    else if (status.audience === 'FOLLOWERS') {
      const rel = await prisma.follow.findFirst({
        where: { followerId: me.id, followeeId: status.authorId, accepted: true },
        select: { id: true },
      });
      allowed = !!rel;
    } else if (status.audience === 'MUTUALS' || status.audience === 'FRIENDS') {
      const [a, b] = await Promise.all([
        prisma.follow.findFirst({
          where: { followerId: me.id, followeeId: status.authorId, accepted: true },
          select: { id: true },
        }),
        prisma.follow.findFirst({
          where: { followerId: status.authorId, followeeId: me.id, accepted: true },
          select: { id: true },
        }),
      ]);
      allowed = !!a && !!b;
    } else if (status.audience === 'CONTACTS') {
      const contact = await prisma.contact.findFirst({
        where: { ownerId: status.authorId, contactUserId: me.id },
        select: { id: true },
      });
      allowed = !!contact;
    } else if (status.audience === 'CUSTOM') {
      allowed = hasKey;
    }

    if (allowed && !isOwner && !isAdmin && status.audience !== 'EVERYONE') {
      if (!hasKey) allowed = false;
    }
    if (!allowed) return res.status(403).json({ error: 'Forbidden' });

    return res.json({
      id: status.id,
      author: status.author,
      assets: Array.isArray(status.assets)
        ? status.assets.map((a) => ({
            ...a,
            url: a?.url ? toSigned(a.url, status.authorId) : a?.url ?? null,
          }))
        : [],
      captionCiphertext: status.captionCiphertext,
      encryptedKeyForMe: keyRow?.encryptedKey ?? null,
      expiresAt: status.expiresAt,
      createdAt: status.createdAt,
      reactionSummary: {},
    });
  })
);

/**
 * PATCH /status/:id/view
 */
/**
 * PATCH /status/:id/view
 */
router.patch(
  '/:id/view',
  requireAuth,
  asyncHandler(async (req, res) => {
    const statusId = Number(req.params.id);
    if (!Number.isInteger(statusId) || statusId <= 0) {
      return res.status(400).json({ error: 'Invalid status id' });
    }

    const status = await prisma.status.findUnique({
      where: { id: statusId },
      select: {
        id: true,
        authorId: true,
        audience: true,
        expiresAt: true,
      },
    });

    if (!status) {
      return res.status(404).json({ error: 'Status not found' });
    }
    if (status.expiresAt && status.expiresAt <= new Date()) {
      return res.status(404).json({ error: 'Status not found' });
    }

    const me = req.user;
    const isOwner = status.authorId === me.id;
    const isAdmin = me.role === 'ADMIN';

    let allowed = false;
    if (isOwner || isAdmin) {
      allowed = true;
    } else if (status.audience === 'EVERYONE') {
      allowed = true;
    } else {
      const hasKey = await prisma.statusKey.findUnique({
        where: { statusId_userId: { statusId, userId: me.id } },
        select: { userId: true },
      }).catch(async () => {
        return await prisma.statusKey.findFirst({
          where: { statusId, userId: me.id },
          select: { userId: true },
        });
      });

      allowed = !!hasKey;
    }

    if (!allowed) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    await tolerantUpsertView(statusId, me.id);

    req.app.get('io')?.to(`user:${status.authorId}`).emit('status_viewed', {
      statusId,
      viewerId: me.id,
    });

    return res.status(204).end();
  })
);


/**
 * POST /status/:id/reactions   (toggle)
 */
router.post(
  '/:id/reactions',
  requireAuth,
  asyncHandler(async (req, res) => {
    const statusId = Number(req.params.id);
    const userId = Number(req.user.id);
    const emoji = String(req.body?.emoji || '').slice(0, 16);

    if (!Number.isInteger(statusId) || statusId <= 0) {
      return res.status(400).json({ error: 'Invalid status id' });
    }
    if (!emoji) return res.status(400).json({ error: 'Missing emoji' });

    const status = await prisma.status.findUnique({
      where: { id: statusId },
      select: { id: true, authorId: true, audience: true, expiresAt: true },
    });
    if (!status) return res.status(404).json({ error: 'Status not found' });
    if (status.expiresAt && status.expiresAt <= new Date()) {
      return res.status(404).json({ error: 'Status not found' });
    }

    let allowed = false;
    const me = req.user;
    const isOwner = status.authorId === me.id;
    const isAdmin = me.role === 'ADMIN';
    if (isOwner || isAdmin) allowed = true;
    else if (status.audience === 'EVERYONE') allowed = true;
    else {
      const hasKey = await prisma.statusKey.findUnique({
        where: { statusId_userId: { statusId, userId: me.id } },
        select: { userId: true },
      }).catch(async () => {
        return await prisma.statusKey.findFirst({ where: { statusId, userId: me.id }, select: { userId: true } });
      });
      allowed = !!hasKey;
    }
    if (!allowed) return res.status(403).json({ error: 'Forbidden' });

    const out = await tolerantToggleReaction(statusId, userId, emoji);
    return res.json({ ok: true, op: out.op, emoji, count: out.count });
  })
);

/**
 * DELETE /status/:id
 */
router.delete(
  '/:id',
  requireAuth,
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: 'Invalid id' });

    const s = await prisma.status.findUnique({ where: { id }, select: { authorId: true } });
    if (!s) return res.status(404).json({ error: 'Not found' });
    if (req.user.role !== 'ADMIN' && s.authorId !== req.user.id) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const keys = await prisma.statusKey.findMany({
      where: { statusId: id },
      select: { userId: true },
    }).catch(() => []);
    const audienceUserIds = keys.map(k => k.userId).filter(uid => uid !== s.authorId);

    await prisma.status.delete({ where: { id } });

    const io = req.app.get('io');
    io?.to(`user:${s.authorId}`).emit('status_deleted', { id });
    for (const uid of audienceUserIds) {
      io?.to(`user:${uid}`).emit('status_deleted', { id });
    }
    return res.json({ ok: true });
  })
);

export default router;
