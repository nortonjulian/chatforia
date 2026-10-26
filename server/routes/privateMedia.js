import express from 'express';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import jwt from 'jsonwebtoken';
import mime from 'mime-types';
import { parseSingleByteRange } from '../utils/httpByteRanges.js';
import { requireAuth } from '../middleware/auth.js';
import {
  getAuthorizedMessageMedia,
  localMessageMediaAbsolutePath,
} from '../services/privateMessageMedia.js';

const router = express.Router();
const MAX_TOKEN_SECONDS = 60;
function secret() {
  if (process.env.FILE_TOKEN_SECRET) return process.env.FILE_TOKEN_SECRET;
  if (process.env.NODE_ENV === 'test') return 'test-secret';
  throw new Error('FILE_TOKEN_SECRET is required');
}
const root = () => process.env.UPLOADS_DIR || path.resolve('uploads');

router.get('/message/:attachmentId', requireAuth, async (req, res) => {
  try {
    const variant = req.query.variant === 'thumb' ? 'thumb' : 'file';
    const claim = await getAuthorizedMessageMedia({
      attachmentId: req.params.attachmentId, viewerId: req.user.id, variant,
    });
    if (!claim) return res.status(404).json({ error: 'Not found' });
    const token = jwt.sign(
      { aid: claim.attachmentId, uid: claim.viewerId, v: variant, aud: 'private-media', iss: 'chatforia' },
      secret(), { expiresIn: MAX_TOKEN_SECONDS }
    );
    res.set('Cache-Control', 'no-store');
    return res.json({ url: `/private-media/file?token=${encodeURIComponent(token)}`, expiresSec: MAX_TOKEN_SECONDS });
  } catch {
    return res.status(500).json({ error: 'Could not authorize media' });
  }
});

/* Bounded capability for native image/video/audio players which may not
 * attach app auth headers. Do not interpret a token as permanent authorization:
 * validate the message and recipient on EVERY download. */
router.get('/file', async (req, res) => {
  try {
    const token = typeof req.query.token === 'string' ? req.query.token : '';
    if (!token || token.length > 4096) return res.sendStatus(403);
    let payload;
    try {
      payload = jwt.verify(token, secret(), { audience: 'private-media', issuer: 'chatforia' });
    } catch {
      return res.sendStatus(403);
    }
    const claim = await getAuthorizedMessageMedia({
      attachmentId: payload.aid, viewerId: payload.uid, variant: payload.v,
    });
    if (!claim) return res.sendStatus(404);
    const abs = localMessageMediaAbsolutePath(claim.relativePath, root());
    if (!abs) return res.sendStatus(404);
    const info = await fsp.stat(abs).catch(() => null);
    if (!info?.isFile()) return res.sendStatus(404);
    const mediaType = mime.lookup(abs) || 'application/octet-stream';
    res.set({
      'Content-Type': mediaType,
      'Content-Disposition': 'inline',
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
      'Accept-Ranges': 'bytes',
    });
    const rangeHeader = req.headers.range;
    if (rangeHeader) {
      const range = parseSingleByteRange(rangeHeader, info.size);
      if (!range) {
        res.set('Content-Range', `bytes */${info.size}`);
        return res.sendStatus(416);
      }
      const { start, end } = range;
      res.set({
        'Content-Range': `bytes ${start}-${end}/${info.size}`,
        'Content-Length': String(end - start + 1),
      });
      if (req.method === 'HEAD') return res.status(206).end();
      const stream = fs.createReadStream(abs, { start, end });
      stream.on('error', () => { if (!res.headersSent) res.sendStatus(404); else res.destroy(); });
      return stream.pipe(res.status(206));
    }
    res.set('Content-Length', String(info.size));
    if (req.method === 'HEAD') return res.status(200).end();
    const stream = fs.createReadStream(abs);
    stream.on('error', () => { if (!res.headersSent) res.sendStatus(404); else res.destroy(); });
    return stream.pipe(res);
  } catch {
    return res.status(500).json({ error: 'Could not retrieve media' });
  }
});

export default router;
