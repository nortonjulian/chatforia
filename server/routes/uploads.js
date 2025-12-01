import express from 'express';
import Boom from '@hapi/boom';
import fs from 'node:fs';
import path from 'node:path';
import multer from 'multer';

import { requireAuth } from '../middleware/auth.js';
import prisma from '../utils/prismaClient.js';
import storage from '../services/storage/index.js';
import { STORAGE_DRIVER } from '../utils/uploadConfig.js';
import { keyToAbsolute } from '../services/storage/localStorage.js';
import { buildSafeName, sha256, uploadDirs } from '../middleware/uploads.js';

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
  await fs.promises.mkdir(path.dirname(abs), { recursive: true });
  await fs.promises.writeFile(abs, buf);
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

  try {
    return await prisma.upload.findFirst({ where: { sha256: digest, ownerId }, select: { id: true } });
  } catch {}
  try {
    return await prisma.upload.findFirst({ where: { sha256: digest, userId: ownerId }, select: { id: true } });
  } catch {}
  try {
    return await prisma.upload.findFirst({ where: { ownerId, key: { contains: `/${digest}.` } }, select: { id: true } });
  } catch {}
  try {
    return await prisma.upload.findFirst({ where: { userId: ownerId, key: { contains: `/${digest}.` } }, select: { id: true } });
  } catch {}
  try {
    return await prisma.upload.findFirst({ where: { key: { contains: `/user/${ownerId}/${digest}.` } }, select: { id: true } });
  } catch {}
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
    (() => { const { sha256: _s, ...rest } = data; return rest; })(),
    (() => { const { ownerId, ...rest } = data; return { ...rest, userId: data.ownerId }; })(),
    (() => ({ ownerId: data.ownerId, key: data.key }))(),
  ];
  for (const payload of attempts) {
    try {
      const rec = await prisma.upload.create({
        data: payload,
        select: { id: true, originalName: true, mimeType: true, size: true, key: true },
      });
      // mirror for ACL + dedup consistency
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
      if (data.sha256) memRegistry.byOwnerDigest.set(`${Number(data.ownerId)}:${data.sha256}`, rec.id);
      return rec;
    } catch {}
  }
  return memCreate(data);
}

/* ---------------- POST /uploads ---------------- */
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

    const key = `user/${Number(req.user.id)}/${(digest || sha256(f.buffer))}.${ext}`;
    await storeWithFallback({ key, buf: f.buffer, contentType: f.mimetype });

    const rec = await createUploadFlexible({
      ownerId: Number(req.user.id),
      key,
      sha256: canDedup ? digest : undefined,
      originalName: suggested,
      mimeType: f.mimetype,
      size: f.size,
      driver: STORAGE_DRIVER,
    });

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

    await fs.promises.access(fullPath, fs.constants.R_OK);

    res.setHeader('Cache-Control', 'public, max-age=86400'); // 1 day
    res.sendFile(fullPath);
  } catch (e) {
    return next(Boom.notFound('avatar not found'));
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
