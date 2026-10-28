import express from 'express';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import jwt from 'jsonwebtoken';
import { issuePrivateMediaGrant, privateMediaTokenSecret } from '../services/privateMediaGrant.js';
import mime from 'mime-types';
import { GetObjectCommand } from '@aws-sdk/client-s3';
import { r2 } from '../utils/r2.js';
import { parseSingleByteRange } from '../utils/httpByteRanges.js';
import { requireAuth } from '../middleware/auth.js';
import {
  getAuthorizedMessageMedia,
  localMessageMediaAbsolutePath,
} from '../services/privateMessageMedia.js';

const router = express.Router();
const root = () => process.env.UPLOADS_DIR || path.resolve('uploads');

router.get('/message/:attachmentId', requireAuth, async (req, res) => {
  try {
    const variant = req.query.variant === 'thumb' ? 'thumb' : 'file';
    const grant = await issuePrivateMediaGrant({
      attachmentId: req.params.attachmentId,
      viewerId: req.user.id,
      variant,
    });
    if (!grant) return res.status(404).json({ error: 'Not found' });
    res.set('Cache-Control', 'no-store');
    return res.json(grant);
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
      payload = jwt.verify(token, privateMediaTokenSecret(), { audience: 'private-media', issuer: 'chatforia' });
    } catch {
      return res.sendStatus(403);
    }
    const claim = await getAuthorizedMessageMedia({
      attachmentId: payload.aid, viewerId: payload.uid, variant: payload.v,
    });
    if (!claim) return res.sendStatus(404);
    if (claim.storageKey) {
      // Stream through the application; a presigned S3 URL would permit
      // continued use until expiration after participant revocation.
      const bucket = process.env.R2_BUCKET;
      if (!bucket) return res.sendStatus(503);
      const range = req.headers.range;
      // R2 enforces byte-range syntax; reject multi-range/invalid requests.
      if (range && !/^bytes=(?:[0-9]+-[0-9]*|-[0-9]+)$/.test(range)) {
        return res.sendStatus(416);
      }
      try {
        const object = await r2.send(new GetObjectCommand({
          Bucket: bucket,
          Key: claim.storageKey,
          ...(range ? { Range: range } : {}),
        }));
        res.set({
          'Cache-Control': 'private, no-store',
          'X-Content-Type-Options': 'nosniff',
          'Referrer-Policy': 'no-referrer',
          'Content-Disposition': 'inline',
          'Accept-Ranges': 'bytes',
          'Content-Type': object.ContentType || 'application/octet-stream',
        });
        if (object.ContentLength != null) res.set('Content-Length', String(object.ContentLength));
        if (object.ContentRange) res.set('Content-Range', object.ContentRange);
        res.status(object.ContentRange ? 206 : 200);
        if (!object.Body) return res.end();
        // AWS SDK Node stream. Never cache, forward or log object bytes.
        object.Body.on('error', () => res.destroy());
        return object.Body.pipe(res);
      } catch (err) {
        const status = err?.$metadata?.httpStatusCode;
        return res.sendStatus(status === 404 ? 404 : status === 416 ? 416 : 502);
      }
    }
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
