import express from 'express';
import Boom from '@hapi/boom';
import fs from 'node:fs';
import path from 'node:path';
import multer from 'multer';
import crypto from 'node:crypto';
import fsPromises from 'node:fs/promises';

import { requireAuth } from '../middleware/auth.js';
import prisma from '../utils/prismaClient.js';
import storage from '../services/storage/index.js';
import { STORAGE_DRIVER } from '../utils/uploadConfig.js';
import { keyToAbsolute } from '../services/storage/localStorage.js';
import { buildSafeName, sha256, uploadDirs } from '../middleware/uploads.js';
import {
  generatePresignedPutUrl,
  buildPublicUrlForKey,
  headStorageObject,
  deleteStorageObject,
  // uploadBufferToStorage // not used here, but available if needed
} from '../utils/storage.js';
import {
  assertCloudStorageAvailable,
  createUploadWithinCloudStorageAllowance,
} from '../services/cloudStorageService.js';

const router = express.Router();

/* Health check — confirms the uploads router is mounted */
router.get('/__iam_uploads_router', (_req, res) =>
  res.json({ ok: true, router: 'uploads' })
);

/* ---------------- In-memory registry (used for ACL/dedup too) ---------------- */
const HAS_UPLOAD_MODEL = !!(prisma?.upload && typeof prisma.upload.create === 'function');
const memRegistry = { nextId: 1, byId: new Map(), byOwnerDigest: new Map() };
const DEDUP_MIN_BYTES = 9; // avoid tiny-collision on fixtures

function memFindExisting(ownerId, digest) {
  const id = memRegistry.byOwnerDigest.get(`${ownerId}:${digest}`);
  return id ? { id } : null;
}
function memCreate(rec) {
  const id = memRegistry.nextId++;
  const payload = { id, ...rec, ownerId: Number(rec.ownerId), persisted: false };
  memRegistry.byId.set(id, payload);
  if (rec.sha256) memRegistry.byOwnerDigest.set(`${payload.ownerId}:${rec.sha256}`, id);
  return { id, originalName: rec.originalName, mimeType: rec.mimeType, size: rec.size, key: rec.key };
}

/* ---------------- Constants & helpers ---------------- */
const MAX_BYTES = Number(process.env.MAX_FILE_SIZE_BYTES || 10 * 1024 * 1024);

function uploadErrorResponse(res, err) {
  if (err?.code === 'STORAGE_ALLOWANCE_EXCEEDED') {
    return res.status(413).json({
      error: 'storage_allowance_exceeded',
      code: err.code,
      limit: err.limit,
      used: err.used,
      requested: err.requested,
      remaining: err.remaining,
    });
  }

  if (err?.code === 'INVALID_UPLOAD_SIZE') {
    return res.status(400).json({
      error: 'invalid_upload_size',
      code: err.code,
    });
  }

  return null;
}

function presignedOwnerPrefix(ownerId) {
  return `uploads/u${Number(ownerId)}/`;
}

function isOwnedPresignedKey(ownerId, key) {
  return String(key || '').startsWith(presignedOwnerPrefix(ownerId));
}

function fallbackSha256ForObject(key, size) {
  return crypto
    .createHash('sha256')
    .update(`object:${String(key)}:${Number(size)}`)
    .digest('hex');
}
const BANNED_MIME = new Set([
  'application/x-msdownload','application/x-msdos-program','application/x-executable',
  'application/x-dosexec','application/x-sh','application/x-bat','application/x-msi','application/x-elf',
]);
const BANNED_EXT = new Set(['.exe','.msi','.bat','.cmd','.sh','.elf','.com','.scr','.ps1','.psm1']);

const looksLikeSvg = (mime, filename) =>
  String(mime || '').toLowerCase() === 'image/svg+xml' || String(filename || '').toLowerCase().endsWith('.svg');

function hasBannedType(mime, filename) {
  const m = String(mime || '').toLowerCase();
  const f = String(filename || '').toLowerCase();
  if (BANNED_MIME.has(m)) return true;
  for (const ext of BANNED_EXT) if (f.endsWith(ext)) return true;
  return false;
}

/* ---------------- Multer (memory) ---------------- */
const mem = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_BYTES } });
function runUpload(req, res, next) {
  return mem.single('file')(req, res, (err) => {
    if (!err) return next();
    if (err?.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ error: 'File too large' });
    return res.status(400).json({ error: err?.message || 'Upload error' });
  });
}

/* ---------------- Storage helpers ---------------- */
async function writeLocalFallback(key, buf) {
  const abs = keyToAbsolute(key);
  await fsPromises.mkdir(path.dirname(abs), { recursive: true });
  await fsPromises.writeFile(abs, buf);
  return abs;
}
async function storeWithFallback({ key, buf, contentType }) {
  try {
    await storage.storeBuffer({ buf, key, contentType });
  } catch {
    await writeLocalFallback(key, buf);
  }
  return true;
}

/* ---------------- Dedup & persistence ---------------- */
async function findExistingByDigestOrKey({ ownerId, digest }) {
  const memHit = memFindExisting(ownerId, digest);
  if (memHit) return memHit;

  if (!HAS_UPLOAD_MODEL) return null;

  // Try several heuristics for compatibility across DB schema variants
  const tries = [
    { sha256: digest, ownerId },
    { ownerId, key: { contains: `/${digest}.` } },
    { key: { contains: `/user/${ownerId}/${digest}.` } },
  ];

  for (const where of tries) {
    try {
      const rec = await prisma.upload.findFirst({ where, select: { id: true } });
      if (rec) return rec;
    } catch {
      // ignore and continue
    }
  }
  return null;
}

async function createUploadFlexible(data) {
  if (!HAS_UPLOAD_MODEL) return memCreate(data);

  const attempts = [
    data,
    (() => { const { driver, ...rest } = data; return rest; })(),
    (() => { const { size, ...rest } = data; return rest; })(),
    (() => { const { mimeType, ...rest } = data; return rest; })(),
    (() => { const { originalName, ...rest } = data; return rest; })(),
    (() => { const { ownerId, ...rest } = data; return { ...rest, userId: data.ownerId }; })(),
    (() => ({ ownerId: data.ownerId, key: data.key, sha256: data.sha256 }))(),
  ];

  for (const payload of attempts) {
    try {
      const rec = await prisma.upload.create({
        data: payload,
        select: { id: true, originalName: true, mimeType: true, size: true, key: true },
      });

      memRegistry.byId.set(rec.id, {
        id: rec.id,
        ownerId: Number(data.ownerId),
        key: data.key,
        mimeType: rec.mimeType,
        originalName: rec.originalName,
        driver: data.driver || 'local',
        size: rec.size,
        persisted: true,
      });

      if (data.sha256) {
        memRegistry.byOwnerDigest.set(`${Number(data.ownerId)}:${data.sha256}`, rec.id);
      }

      return rec;
    } catch {
      // try next
    }
  }

  return memCreate(data);
}

/* ---------------- NEW — POST /uploads/intent ----------------
   Client calls to get a presigned PUT URL and canonical key.
   Body: { name, size, mimeType, sha256? }
*/
router.post('/intent', requireAuth, async (req, res) => {
  try {
    const { name, size, mimeType, sha256: sha } = req.body || {};
    if (!name || !mimeType) return res.status(400).json({ error: 'invalid_request' });

    const ownerId = Number(req.user?.id);
    const declaredSize = Math.floor(Number(size));

    if (!Number.isInteger(ownerId) || ownerId <= 0) {
      return res.status(403).json({ error: 'no_access' });
    }

    if (!Number.isFinite(declaredSize) || declaredSize <= 0) {
      return res.status(400).json({ error: 'invalid_upload_size' });
    }

    if (Number.isFinite(MAX_BYTES) && declaredSize > MAX_BYTES) {
      return res.status(413).json({ error: 'File too large' });
    }

    try {
      await assertCloudStorageAvailable({
        userId: ownerId,
        requestedBytes: declaredSize,
      });
    } catch (err) {
      const handled = uploadErrorResponse(res, err);
      if (handled) return handled;
      throw err;
    }

    // build a stable, owner-scoped key
    const now = new Date();
    const safe = (name || 'file').replace(/[^\w.\-]+/g, '_').slice(0, 120);
    const prefix = `${presignedOwnerPrefix(ownerId)}${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2,'0')}/${String(now.getUTCDate()).padStart(2,'0')}`;
    const rand = crypto.randomBytes(6).toString('hex');
    const ext = path.extname(safe) || '';
    const base = path.basename(safe, ext);
    const key = `${prefix}/${Date.now()}_${rand}_${base}${ext}`;

    // If STORAGE_BUCKET is configured, return a presigned PUT URL
    if (process.env.R2_BUCKET) {
      const expires = Number(process.env.R2_SIGNED_EXPIRES_SEC || process.env.STORAGE_SIGNED_EXPIRES_SEC || 300);
      const { url: uploadUrl, expiresIn } = await generatePresignedPutUrl({ key, contentType: mimeType, expiresIn: expires });

      const publicUrl = process.env.R2_PUBLIC_BASE ? buildPublicUrlForKey(key) : undefined;

      return res.json({
        uploadUrl,
        key,
        expiresIn,
        publicUrl,
        requiresComplete: true,
      });
    }

    // Fallback: no cloud storage configured
    return res.status(500).json({ error: 'no_storage_configured' });
  } catch (err) {
    console.error('uploads.intent error', err);
    return res.status(500).json({ error: 'server_error' });
  }
});

/* ---------------- NEW — POST /uploads/complete ----------------
   Client calls after successful PUT to presigned URL.
   Body: { key, name, mimeType, size, width?, height?, durationSec?, sha256? }
*/
router.post('/complete', requireAuth, async (req, res) => {
  try {
    const { key, name, mimeType, size, width, height, durationSec, sha256: sha } = req.body || {};
    if (!key || !mimeType) return res.status(400).json({ error: 'invalid_request' });

    const ownerId = Number(req.user?.id) || null;

    if (!Number.isInteger(ownerId) || ownerId <= 0) {
      return res.status(403).json({ error: 'no_access' });
    }

    if (!isOwnedPresignedKey(ownerId, key)) {
      return res.status(403).json({ error: 'invalid_upload_key' });
    }

    let storedObject;
    try {
      storedObject = await headStorageObject({ key });
    } catch (err) {
      console.error('uploads.complete head error', err);
      return res.status(400).json({ error: 'uploaded_object_not_found' });
    }

    const actualSize = Math.floor(Number(storedObject?.size || 0));

    if (!Number.isFinite(actualSize) || actualSize <= 0) {
      return res.status(400).json({ error: 'invalid_uploaded_object_size' });
    }

    if (Number.isFinite(MAX_BYTES) && actualSize > MAX_BYTES) {
      await deleteStorageObject({ key }).catch(() => {});
      return res.status(413).json({ error: 'File too large' });
    }

    // If storage is public, construct public URL (otherwise client may fetch signed GET)
    const publicUrl = process.env.R2_PUBLIC_BASE ? buildPublicUrlForKey(key) : null;

    const uploadPayload = {
      ownerId,
      key,
      sha256: (
        typeof sha === 'string' &&
        /^[a-f0-9]{64}$/i.test(sha)
      )
        ? sha.toLowerCase()
        : fallbackSha256ForObject(key, actualSize),
      originalName: name || path.basename(key),
      mimeType,
      size: actualSize,
      driver: process.env.R2_BUCKET ? 's3' : 'local',
    };

    let uploadRow;

    try {
      const result = await createUploadWithinCloudStorageAllowance({
        userId: ownerId,
        uploadData: uploadPayload,
      });
      uploadRow = result.upload;
    } catch (err) {
      if (err?.code === 'STORAGE_ALLOWANCE_EXCEEDED') {
        await deleteStorageObject({ key }).catch(() => {});
      }

      const handled = uploadErrorResponse(res, err);
      if (handled) return handled;
      throw err;
    }

    memRegistry.byId.set(uploadRow.id, {
      id: uploadRow.id,
      ownerId,
      key: uploadRow.key,
      mimeType: uploadRow.mimeType,
      originalName: uploadRow.originalName,
      driver: uploadRow.driver,
      size: uploadRow.size,
      persisted: true,
    });

    memRegistry.byOwnerDigest.set(
      `${ownerId}:${uploadRow.sha256}`,
      uploadRow.id,
    );

    // (Optional) Thumbnail generation: skip heavy operations in this route to keep it fast.
    // You can enqueue a worker or separate job to generate thumbs from the bucket.
    let thumbUrl = null;
    try {
      // If you want to attempt a server-side thumb generation only when you can read the object,
      // you could fetch and run sharp here. We'll skip by default to avoid blocking.
      if (mimeType.startsWith('image/') && process.env.STORAGE_BUCKET && process.env.STORAGE_PUBLIC_BASE_URL) {
        // recommended: enqueue a worker that downloads key, creates thumb, stores thumb key,
        // and updates the upload record with thumbUrl. Skipping here.
      }
    } catch (thumbErr) {
      console.warn('thumb generation skipped:', thumbErr);
    }

    const fileMeta = {
      id: uploadRow.id,
      key: uploadRow.key,
      url: publicUrl || null,
      name: uploadRow.originalName,
      contentType: uploadRow.mimeType,
      size: uploadRow.size,
      width: width || null,
      height: height || null,
      durationSec: durationSec || null,
      thumbUrl,
    };

    return res.json({ ok: true, file: fileMeta });
  } catch (err) {
    console.error('uploads.complete error', err);
    return res.status(500).json({ error: 'server_error' });
  }
});

/* ---------------- POST /uploads (multipart form upload - existing) ---------------- */
router.post('/', requireAuth, runUpload, async (req, res, next) => {
  try {
    const f = req.file;
    if (!f || !f.buffer) return res.status(400).json({ error: 'file is required' });
    if (Number.isFinite(MAX_BYTES) && f.size > MAX_BYTES) return res.status(413).json({ error: 'File too large' });
    if (looksLikeSvg(f.mimetype, f.originalname)) return res.status(415).json({ error: 'SVG not allowed' });
    if (hasBannedType(f.mimetype, f.originalname)) return res.status(415).json({ error: 'Executable type not allowed' });

    const { ext, suggested } = buildSafeName(f.mimetype, f.originalname);
    const canDedup = (f.size || f.buffer.length || 0) >= DEDUP_MIN_BYTES;
    const digest = canDedup ? sha256(f.buffer) : null;

    if (canDedup) {
      const existing = await findExistingByDigestOrKey({ ownerId: Number(req.user.id), digest });
      if (existing) return res.status(200).json({ id: existing.id, dedup: true });
    }

    const ownerId = Number(req.user.id);
    const key = `user/${ownerId}/${(digest || sha256(f.buffer))}.${ext}`;
    const uploadDigest = digest || sha256(f.buffer);

    let rec;

    try {
      const result = await createUploadWithinCloudStorageAllowance({
        userId: ownerId,
        uploadData: {
          ownerId,
          key,
          sha256: uploadDigest,
          originalName: suggested,
          mimeType: f.mimetype,
          size: f.size,
          driver: STORAGE_DRIVER,
        },
      });

      rec = result.upload;
    } catch (err) {
      const handled = uploadErrorResponse(res, err);
      if (handled) return handled;
      throw err;
    }

    try {
      await storeWithFallback({ key, buf: f.buffer, contentType: f.mimetype });
    } catch (err) {
      await prisma.upload.delete({
        where: { id: rec.id },
      }).catch(() => {});
      throw err;
    }

    memRegistry.byId.set(rec.id, {
      id: rec.id,
      ownerId,
      key: rec.key,
      mimeType: rec.mimeType,
      originalName: rec.originalName,
      driver: rec.driver,
      size: rec.size,
      persisted: true,
    });

    memRegistry.byOwnerDigest.set(
      `${ownerId}:${uploadDigest}`,
      rec.id,
    );

    return res.status(201).json({
      id: rec.id,
      name: rec.originalName ?? suggested,
      mimeType: rec.mimeType ?? f.mimetype,
      size: rec.size ?? f.size,
    });
  } catch (e) {
    next(e.isBoom ? e : Boom.badRequest(e.message || 'Upload failed'));
  }
});

/* ---------------- GET /uploads/avatar/:filename ---------------- */
router.get('/avatar/:filename', async (req, res, next) => {
  try {
    // prevent path traversal – only use the basename
    const fileName = path.basename(req.params.filename);
    const fullPath = path.join(uploadDirs.AVATARS_DIR, fileName);

    await fsPromises.access(fullPath, fs.constants.R_OK);

    res.setHeader('Cache-Control', 'public, max-age=86400'); // 1 day
    res.sendFile(fullPath);
  } catch (e) {
    return next(Boom.notFound('avatar not found'));
  }
});

/* ---------------- DELETE /uploads/:id ---------------- */
router.delete('/:id', requireAuth, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const ownerId = Number(req.user?.id);

    if (!Number.isInteger(id) || id <= 0) {
      throw Boom.badRequest('invalid id');
    }

    if (!Number.isInteger(ownerId) || ownerId <= 0) {
      throw Boom.forbidden('no access');
    }

    const upload = await prisma.upload.findFirst({
      where: {
        id,
        ownerId,
      },
      select: {
        id: true,
        ownerId: true,
        key: true,
        sha256: true,
        driver: true,
      },
    });

    if (!upload) {
      throw Boom.notFound('upload not found');
    }

    if (upload.driver === 's3') {
      await deleteStorageObject({ key: upload.key });
    } else {
      await storage.deleteFile(upload.key);
    }

    await prisma.upload.delete({
      where: { id: upload.id },
    });

    memRegistry.byId.delete(upload.id);
    if (upload.sha256) {
      memRegistry.byOwnerDigest.delete(
        `${ownerId}:${upload.sha256}`,
      );
    }

    return res.json({
      ok: true,
      id: upload.id,
    });
  } catch (e) {
    next(e.isBoom ? e : Boom.badRequest(e.message || 'Delete failed'));
  }
});

/* ---------------- GET /uploads/:id ---------------- */
router.get('/:id', requireAuth, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) throw Boom.badRequest('invalid id');

    const reqUid = Number(req.user.id);
    if (!Number.isInteger(reqUid) || reqUid <= 0) throw Boom.forbidden('no access');

    // In-memory mirror lookup (authoritative for runtime)
    const mem = memRegistry.byId.get(id) || null;
    if (!mem) throw Boom.forbidden('no access');

    const memOwner = Number(mem.ownerId);
    if (!Number.isInteger(memOwner) || memOwner !== reqUid) throw Boom.forbidden('no access');

    // Extra guard: enforce that the key encodes the same owner (support 'user/...' or '/user/...')
    const keyStr = String(mem.key || '');
    let keyOwner = NaN;
    if (keyStr.startsWith('user/')) {
      const parts = keyStr.split('/');
      if (parts.length >= 2) keyOwner = Number(parts[1]);
    } else {
      const m = keyStr.match(/\/user\/(\d+)\//);
      if (m) keyOwner = Number(m[1]);
    }
    if (!Number.isInteger(keyOwner) || keyOwner !== reqUid) throw Boom.forbidden('no access');

    // Stream after ACL passes
    res.setHeader('Content-Type', mem.mimeType || 'application/octet-stream');
    if (mem.size != null) res.setHeader('Content-Length', mem.size);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${encodeURIComponent(mem.originalName || 'file')}"`
    );

    if (mem.driver === 's3') {
      const { readStream } = await import('../services/storage/s3Storage.js');
      const s3 = await readStream({ key: mem.key });
      if (!s3.ok) throw Boom.badGateway('read failed');
      s3.body.pipe(res);
    } else {
      const abs = keyToAbsolute(mem.key);
      const rs = fs.createReadStream(abs);
      rs.on('error', () => next(Boom.notFound('file missing')));
      rs.pipe(res);
    }
  } catch (e) {
    next(e.isBoom ? e : Boom.badRequest(e.message || 'Download failed'));
  }
});

const uploadsRouter = router;
export { uploadsRouter };
export default router;