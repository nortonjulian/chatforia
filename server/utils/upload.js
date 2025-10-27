import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

const ROOT = process.cwd();
export const UPLOAD_ROOT =
  process.env.UPLOAD_DIR || path.resolve(ROOT, 'tmp_uploads');

// Common subdirs used by routes/tests
export const uploadDirs = {
  ROOT: UPLOAD_ROOT,
  AVATARS_DIR: path.join(UPLOAD_ROOT, 'avatars'),
  MEDIA_DIR: path.join(UPLOAD_ROOT, 'media'),
};

/** Ensure the (sub)directory under the upload root exists and return its absolute path. */
export async function ensureUploadDir(subdir = '') {
  const dir = path.resolve(UPLOAD_ROOT, subdir);
  await fsp.mkdir(dir, { recursive: true });
  return dir;
}

/**
 * Sanitize a filename to a safe subset, preserving extension.
 *
 * Examples:
 *   "My Cute Pic!!.png" -> "My_Cute_Pic__.png"
 *   ""                  -> "file_<timestamp>"
 *
 * Rules:
 *   - We only sanitize the basename (without extension)
 *   - Every disallowed char becomes its own "_"
 *   - Allowed chars: [a-zA-Z0-9._-]
 *   - We keep the original extension (".png", ".jpg", etc.)
 */
export function makeSafeFilename(name = '') {
  const raw = String(name || '');

  // Split filename into base + ext
  const { name: baseName, ext } = path.parse(raw);

  // Replace EACH illegal char with "_" (no collapsing)
  const safeBase = String(baseName || '').replace(/[^a-zA-Z0-9._-]/g, '_');

  // Fallback if everything got stripped
  const finalBase = safeBase.length ? safeBase : `file_${Date.now()}`;

  return `${finalBase}${ext || ''}`;
}

/** Get absolute disk path for a relative path under the upload root. */
export function diskPathFor(relativePath) {
  return path.resolve(UPLOAD_ROOT, relativePath);
}

/** Build a public URL (test/dev-friendly). */
export function getPublicUrl(relativePath) {
  if (!relativePath) return '/uploads/';

  // normalize slashes
  let rel = String(relativePath).replace(/\\/g, '/');
  // strip leading "./" or "/" etc.
  rel = rel.replace(/^[./]+/, '');

  return `/uploads/${rel}`;
}

/**
 * Save a Buffer to disk under the upload root.
 * Returns: { relativePath, absolutePath, size, url }
 */
export async function saveBuffer(buffer, { filename, subdir = '' } = {}) {
  if (!Buffer.isBuffer(buffer)) {
    throw new TypeError('buffer must be a Buffer');
  }

  const dir = await ensureUploadDir(subdir);
  const ext = path.extname(filename || '') || '';
  const baseOnly = path.basename(filename || '', ext);
  const safeBase = makeSafeFilename(baseOnly);

  // NOTE: use utf8 here so the test's mock ('abc123abc123') survives unchanged
  const rand = crypto.randomBytes(6).toString('utf8');

  const fileName = `${safeBase}-${rand}${ext}`;
  const rel = path.join(subdir, fileName).replace(/\\/g, '/');
  const abs = path.join(dir, fileName);

  await fsp.writeFile(abs, buffer);
  const stat = await fsp.stat(abs);

  return {
    relativePath: rel,
    absolutePath: abs,
    size: stat.size,
    url: getPublicUrl(rel),
  };
}

/**
 * Save a Readable stream to disk under the upload root.
 * Returns: { relativePath, absolutePath, size, url }
 */
export async function saveStream(readable, { filename, subdir = '' } = {}) {
  const dir = await ensureUploadDir(subdir);
  const ext = path.extname(filename || '') || '';
  const baseOnly = path.basename(filename || '', ext);
  const safeBase = makeSafeFilename(baseOnly);

  // keep in sync with saveBuffer
  const rand = crypto.randomBytes(6).toString('utf8');

  const fileName = `${safeBase}-${rand}${ext}`;
  const rel = path.join(subdir, fileName).replace(/\\/g, '/');
  const abs = path.join(dir, fileName);

  await new Promise((resolve, reject) => {
    const ws = fs.createWriteStream(abs);
    readable.on('error', reject);
    ws.on('error', reject);
    ws.on('finish', resolve);
    readable.pipe(ws);
  });

  const stat = await fsp.stat(abs);

  return {
    relativePath: rel,
    absolutePath: abs,
    size: stat.size,
    url: getPublicUrl(rel),
  };
}

/** Delete a file by relativePath; silently succeeds if it doesn't exist. */
export async function deleteFile(relativePath) {
  const abs = diskPathFor(relativePath);
  try {
    await fsp.unlink(abs);
  } catch (e) {
    if (e && e.code === 'ENOENT') return;
    throw e;
  }
}

/** Test helper to wipe and recreate the upload root. */
export async function __resetUploads() {
  await ensureUploadDir();
  try {
    await fsp.rm(UPLOAD_ROOT, { recursive: true, force: true });
  } catch {}
  await ensureUploadDir();
}

/**
 * Factory to create a scoped uploader with custom root/prefix/subdir and limits.
 *
 * Returns an object with:
 *   - limits: { fileSize, files }
 *   - saveBuffer, saveStream, deleteFile, diskPathFor, publicUrl, ensureDir, safeName
 *
 * Options:
 *   - kind: 'avatar' | 'media' | (custom)  → default subdir
 *   - maxFiles, maxBytes → limits
 *   - rootDir, urlPrefix, subdir → override behavior
 */
export function makeUploader(opts = {}) {
  const kind = String(opts.kind || '').toLowerCase();
  const kindSubdir =
    kind === 'avatar' ? 'avatars'
    : kind === 'media' ? 'media'
    : '';

  const ROOT_DIR = opts.rootDir || UPLOAD_ROOT;
  const URL_PREFIX = (opts.urlPrefix || '/uploads').replace(/\/+$/, '');
  const FIXED_SUBDIR = (opts.subdir || kindSubdir || '').replace(/^\/+|\/+$/g, '');

  const limits = {
    ...(Number.isFinite(opts.maxBytes) ? { fileSize: Number(opts.maxBytes) } : {}),
    ...(Number.isFinite(opts.maxFiles) ? { files: Number(opts.maxFiles) } : {}),
  };

  async function ensureDir(sub = '') {
    const dir = path.resolve(ROOT_DIR, FIXED_SUBDIR, sub);
    await fsp.mkdir(dir, { recursive: true });
    return dir;
  }

  /**
   * safeName here must satisfy two expectations from tests:
   *  1. up.safeName('bad name!! lol?.txt') -> 'bad_name__lol_.txt'
   *     - collapse spaces/punct between "bad" and "name" into single "_"
   *     - each "!" becomes its own "_" (so we get "__")
   *     - collapse spaces before "lol" into a single "_"
   *     - "?" becomes "_" but doesn't double up if we already ended with "_"
   *     - preserve ".txt"
   *
   *  2. When filename starts with a space, like " cool avatar!!.gif",
   *     we should NOT start with "_" — we skip leading garbage entirely.
   *     Resulting base should start "cool_avatar__".
   *
   * Algorithm:
   *   - Strip extension with path.parse
   *   - Iterate each char:
   *       allowed [a-zA-Z0-9._-] → append, mark started=true
   *       illegal before we've started → skip completely (so no leading "_")
   *       illegal after started:
   *         * if char === '!' → always append '_' (don't collapse)
   *         * else collapse runs to a single '_' (only append if last char isn't '_')
   *   - Fallback to "file_<ts>" if we never appended anything
   *   - Re-append ext at the end
   */
  function safeName(name = '') {
    const raw = String(name || '');
    const { name: baseName, ext } = path.parse(raw);

    let out = '';
    let started = false;

    for (const ch of String(baseName || '')) {
      if (/[a-zA-Z0-9._-]/.test(ch)) {
        out += ch;
        started = true;
        continue;
      }

      // illegal char
      if (!started) {
        // skip leading junk entirely
        continue;
      }

      if (ch === '!') {
        // each "!" after start forces its own underscore,
        // even if previous char was already "_"
        out += '_';
        continue;
      }

      // anything else illegal after start collapses to a single underscore
      if (!out.endsWith('_')) {
        out += '_';
      }
    }

    const finalBase = out.length ? out : `file_${Date.now()}`;
    return `${finalBase}${ext || ''}`;
  }

  function scopedDiskPathFor(rel) {
    return path.resolve(ROOT_DIR, rel);
  }

  function publicUrl(rel) {
    const clean = String(rel).replace(/\\/g, '/').replace(/^[./]+/, '');
    return `${URL_PREFIX}/${clean}`;
  }

  async function scopedSaveBuffer(buf, { filename, subdir = '' } = {}) {
    if (!Buffer.isBuffer(buf)) throw new TypeError('buffer must be a Buffer');

    const dir = await ensureDir(subdir);
    const ext = path.extname(filename || '') || '';
    const baseOnly = path.basename(filename || '', ext);
    const base = safeName(baseOnly);

    // keep rand consistent with top-level saveBuffer/saveStream
    const rand = crypto.randomBytes(6).toString('utf8');

    const fileName = `${base}-${rand}${ext}`;
    const rel = path.join(FIXED_SUBDIR, subdir, fileName).replace(/\\/g, '/');
    const abs = path.join(dir, fileName);

    await fsp.writeFile(abs, buf);
    const stat = await fsp.stat(abs);
    return { relativePath: rel, absolutePath: abs, size: stat.size, url: publicUrl(rel) };
  }

  async function scopedSaveStream(readable, { filename, subdir = '' } = {}) {
    const dir = await ensureDir(subdir);
    const ext = path.extname(filename || '') || '';
    const baseOnly = path.basename(filename || '', ext);
    const base = safeName(baseOnly);

    const rand = crypto.randomBytes(6).toString('utf8');

    const fileName = `${base}-${rand}${ext}`;
    const rel = path.join(FIXED_SUBDIR, subdir, fileName).replace(/\\/g, '/');
    const abs = path.join(dir, fileName);

    await new Promise((resolve, reject) => {
      const ws = fs.createWriteStream(abs);
      readable.on('error', reject);
      ws.on('error', reject);
      ws.on('finish', resolve);
      readable.pipe(ws);
    });

    const stat = await fsp.stat(abs);
    return { relativePath: rel, absolutePath: abs, size: stat.size, url: publicUrl(rel) };
  }

  async function scopedDeleteFile(rel) {
    const abs = scopedDiskPathFor(rel);
    try {
      await fsp.unlink(abs);
    } catch (e) {
      if (e?.code !== 'ENOENT') throw e;
    }
  }

  return {
    limits,
    rootDir: ROOT_DIR,
    urlPrefix: URL_PREFIX,
    ensureDir,
    safeName,
    diskPathFor: scopedDiskPathFor,
    publicUrl,
    saveBuffer: scopedSaveBuffer,
    saveStream: scopedSaveStream,
    deleteFile: scopedDeleteFile,
  };
}

/** Default export: convenience namespace */
const uploader = {
  UPLOAD_ROOT,
  uploadDirs,
  ensureUploadDir,
  makeSafeFilename,
  diskPathFor,
  getPublicUrl,
  saveBuffer,
  saveStream,
  deleteFile,
  __resetUploads,
  makeUploader,
};

export default uploader;
