import { Router } from 'express';
import multer from 'multer';
import crypto from 'crypto';
import path from 'path';

import prisma from '../utils/prismaClient.js';
import { requireAuth } from '../middleware/auth.js';
import { r2PutObject, r2PresignGet } from '../utils/r2.js';

const router = Router();

/* ---------------------------- Config & helpers ---------------------------- */

// MIME whitelist
const ACCEPTED_MIME = new Set([
  // images
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'image/avif',
  // audio
  'audio/mpeg',
  'audio/mp4',
  'audio/aac',
  'audio/ogg',
  'audio/webm',
  'audio/wav',
  // video (optional)
  'video/mp4',
  'video/webm',
  // docs (optional)
  'application/pdf',
]);

// Per-plan file size limits (MB)
const PLAN_LIMITS_MB = { free: 10, pro: 100, team: 250 };
function getMaxMbForUser(user) {
  const plan = user?.plan || 'free';
  return PLAN_LIMITS_MB[plan] ?? PLAN_LIMITS_MB.free;
}

// Unique, user-scoped key
function makeObjectKey(userId, originalName) {
  const ext = path.extname(originalName || '').slice(1)?.toLowerCase();
  const safeExt = ext && /^[a-z0-9]+$/.test(ext) ? `.${ext}` : '';
  const rand = crypto.randomBytes(8).toString('hex');
  const stamp = Date.now();
  return `uploads/u${userId}/${stamp}-${rand}${safeExt}`;
}

// Access mode:
// - Public bucket/custom domain: return public URL
// - Private bucket: return presigned URL (short-lived)
const REQUIRE_SIGNED = String(process.env.R2_REQUIRE_SIGNED || '').toLowerCase() === 'true';
const PUBLIC_BASE = (process.env.R2_PUBLIC_BASE || '').replace(/\/+$/, ''); // e.g. https://media.chatforia.com

// Warn if running in PUBLIC mode without a CDN/base URL
if (!process.env.R2_PUBLIC_BASE && String(process.env.R2_REQUIRE_SIGNED || '').toLowerCase() !== 'true') {
  console.warn('[media] PUBLIC mode without R2_PUBLIC_BASE; returned URLs may not be CDN-backed');
}

/* --------------------------------- Upload -------------------------------- */
// POST /media/upload  (field name: "file")
router.post(
  '/upload',
  requireAuth,
  (req, res, next) => {
    const maxMb = getMaxMbForUser(req.user);

    const upload = multer({
      storage: multer.memoryStorage(),
      limits: { fileSize: maxMb * 1024 * 1024 },
      fileFilter: (_req, file, cb) =>
        ACCEPTED_MIME.has(file.mimetype) ? cb(null, true) : cb(new Error('Unsupported file type')),
    }).single('file');

    upload(req, res, (err) => {
      if (!err) return next();
      if (String(err?.message || '').toLowerCase().includes('file too large')) {
        return res.status(413).json({ error: 'File too large' });
      }
      return res.status(400).json({ error: err.message });
    });
  },
  async (req, res) => {
    try {
      if (!req.file) return res.status(400).json({ error: 'No file uploaded' })

      const userId = req.user?.id;
      const key = makeObjectKey(userId, req.file.originalname);

      await r2PutObject({
        key,
        body: req.file.buffer,
        contentType: req.file.mimetype,
      });

      if (!REQUIRE_SIGNED && PUBLIC_BASE) {
        const url = `${PUBLIC_BASE}/${key}`;
        return res.json({
          ok: true,
          key,
          url,
          access: 'public',
          contentType: req.file.mimetype,
          size: req.file.size,
        });
      } else {
        const expiresSec = Number(process.env.R2_SIGNED_EXPIRES_SEC || 120);
        const signedUrl = await r2PresignGet({ key, expiresSec });
        return res.json({
          ok: true,
          key,
          url: signedUrl,
          access: 'signed',
          expiresSec,
          contentType: req.file.mimetype,
          size: req.file.size,
        });
      }
    } catch (err) {
      console.error('R2 upload failed:', err?.name, err?.message);
      console.error(err);
      return res.status(500).json({ error: 'Upload failed' });
    }
  }
);

/* --------------------------- On-demand signed URL ------------------------- */
/**
 * GET /media/signed-url?key=uploads/u123/...
 * Use when bucket is private and you need to refresh access.
 * Includes a minimal authorization check against message attachments.
 */
router.get('/signed-url', requireAuth, async (req, res) => {
  try {
    const key = String(req.query.key || '').trim();
    if (!key) return res.status(400).json({ error: 'Missing key' });

    // Find an attachment that references this key (url equals key or endsWith /key)
    const att = await prisma.messageAttachment.findFirst({
      where: {
        OR: [{ url: { endsWith: `/${key}` } }, { url: key }],
      },
      select: {
        id: true,
        url: true,
        message: { select: { chatRoomId: true } },
      },
    });
    if (!att) return res.status(404).json({ error: 'Attachment not found' });

    // Membership/role gate
    const chatRoomId = att.message?.chatRoomId;
    const userId = req.user.id;

    if (req.user.role !== 'ADMIN') {
      const member = await prisma.participant.findFirst({
        where: { chatRoomId, userId },
        select: { id: true },
      });
      if (!member) return res.status(403).json({ error: 'Forbidden' });
    }

    const expiresSec = Number(process.env.R2_SIGNED_EXPIRES_SEC || 120);
    const url = await r2PresignGet({ key, expiresSec });
    return res.json({ url, expiresSec });
  } catch (err) {
    console.error('signed-url error:', err);
    return res.status(500).json({ error: 'Could not presign URL' });
  }
});

/* --------------------------- List media for room -------------------------- */
// GET /media/chatrooms/:id/media
router.get('/chatrooms/:id/media', requireAuth, async (req, res) => {
  const chatRoomId = Number(req.params.id);
  const userId = req.user.id;

  // membership gate
  const member = await prisma.participant.findFirst({
    where: { chatRoomId, userId },
  });
  if (!member && req.user.role !== 'ADMIN')
    return res.status(403).json({ error: 'Forbidden' });

  const rows = await prisma.messageAttachment.findMany({
    where: { message: { chatRoomId } },
    orderBy: { createdAt: 'desc' },
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
      message: {
        select: {
          id: true,
          createdAt: true,
          sender: { select: { id: true, username: true, avatarUrl: true } },
        },
      },
    },
  });

  res.json(rows);
});

export default router;
