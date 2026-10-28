/** @jest-environment node */
import { jest, describe, test, expect, beforeAll, afterAll, beforeEach } from '@jest/globals';
import express from 'express';
import request from 'supertest';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs/promises';
import jwt from 'jsonwebtoken';

const record = {
  exists: true,
  deletedAt: null,
  deletedForAll: false,
  expiresAt: null,
  isMember: true,
  clearedAt: null,
};

const db = {
  messageAttachment: {
    findUnique: jest.fn(async ({ where }) => {
      if (!record.exists || Number(where.id) !== 42) return null;
      return {
        id: 42,
        url: 'media/private.txt',
        thumbUrl: 'thumbs/private-thumb.txt',
        deletedAt: record.deletedAt,
        message: {
          id: 100,
          chatRoomId: 8,
          senderId: 1,
          createdAt: new Date('2026-01-01'),
          expiresAt: record.expiresAt,
          deletedForAll: record.deletedForAll,
          deletedBySender: false,
          deletions: [],
        },
      };
    }),
  },
  participant: {
    findUnique: jest.fn(async ({ where }) =>
      record.isMember && Number(where.chatRoomId_userId.userId) === 2
        ? { id: 9, clearedAt: record.clearedAt }
        : null),
  },
  threadState: { findUnique: jest.fn(async () => null) },
};

await jest.unstable_mockModule('../utils/prismaClient.js', () => ({
  __esModule: true, default: db,
}));
await jest.unstable_mockModule('../middleware/auth.js', () => ({
  __esModule: true,
  requireAuth: (req, res, next) => {
    const id = Number(req.headers['x-test-user-id']);
    if (!Number.isSafeInteger(id) || id <= 0) return res.sendStatus(401);
    req.user = { id, role: 'USER' };
    next();
  },
}));

const { default: privateMediaRouter } = await import('../routes/privateMedia.js');

const app = express();
app.use('/private-media', privateMediaRouter);

let root;
let priorDir;
beforeAll(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'chatforia-media-http-'));
  priorDir = process.env.UPLOADS_DIR;
  process.env.UPLOADS_DIR = root;
  await fs.mkdir(path.join(root, 'media'), { recursive: true });
  await fs.mkdir(path.join(root, 'thumbs'), { recursive: true });
  await fs.writeFile(path.join(root, 'media', 'private.txt'), 'private media bytes');
  await fs.writeFile(path.join(root, 'thumbs', 'private-thumb.txt'), 'private thumbnail');
});
afterAll(async () => {
  if (priorDir === undefined) delete process.env.UPLOADS_DIR;
  else process.env.UPLOADS_DIR = priorDir;
  await fs.rm(root, { recursive: true, force: true });
});
beforeEach(() => {
  Object.assign(record, {
    exists: true, deletedAt: null, deletedForAll: false,
    expiresAt: null, isMember: true, clearedAt: null,
  });
});

async function issue(userId = 2, variant = 'file') {
  return request(app).get('/private-media/message/42')
    .set('x-test-user-id', String(userId)).query({ variant });
}

describe('real private media HTTP route: authenticated issuance and bounded playback', () => {
  test('unauthenticated issuance denied, authorized participant allowed, stranger denied', async () => {
    expect((await request(app).get('/private-media/message/42')).status).toBe(401);
    expect((await issue(3)).status).toBe(404);

    const grant = await issue();
    expect(grant.status).toBe(200);
    expect(grant.body.expiresSec).toBe(60);
    expect(grant.body.url).toMatch(/^\/private-media\/file\?token=/);
    expect(grant.headers['cache-control']).toContain('no-store');

    const download = await request(app).get(grant.body.url);
    expect(download.status).toBe(200);
    expect(download.text).toBe('private media bytes');
    expect(download.headers['cache-control']).toContain('no-store');
    expect(download.headers['x-content-type-options']).toBe('nosniff');
  });

  test('authorized thumbnails and audio/video-style byte ranges remain usable', async () => {
    const grant = await issue();
    const partial = await request(app).get(grant.body.url).set('Range', 'bytes=0-6');
    expect(partial.status).toBe(206);
    expect(partial.text).toBe('private');
    expect(partial.headers['content-range']).toBe('bytes 0-6/19');
    expect(partial.headers['accept-ranges']).toBe('bytes');

    const badRange = await request(app).get(grant.body.url).set('Range', 'bytes=99-');
    expect(badRange.status).toBe(416);

    const thumb = await issue(2, 'thumb');
    expect(thumb.status).toBe(200);
    expect((await request(app).get(thumb.body.url)).text).toBe('private thumbnail');
  });

  test('existing token is revoked after membership loss, message deletion or expiry', async () => {
    for (const state of [
      { isMember: false },
      { deletedForAll: true },
      { expiresAt: new Date('2025-01-01') },
      { clearedAt: new Date('2026-02-01') },
    ]) {
      Object.assign(record, {
        isMember: true, deletedForAll: false, expiresAt: null, clearedAt: null,
      });
      const grant = await issue();
      expect(grant.status).toBe(200);
      Object.assign(record, state);
      const denied = await request(app).get(grant.body.url);
      expect(denied.status).toBe(404);
      expect(denied.text).not.toContain('private media bytes');
    }
  });

  test('invalid and expired capabilities never return private bytes', async () => {
    expect((await request(app).get('/private-media/file?token=invalid')).status).toBe(403);

    const expired = jwt.sign(
      { aid: 42, uid: 2, v: 'file', aud: 'private-media', iss: 'chatforia',
        exp: Math.floor(Date.now() / 1000) - 30 },
      process.env.FILE_TOKEN_SECRET || 'test-secret'
    );
    const denied = await request(app).get('/private-media/file').query({ token: expired });
    expect(denied.status).toBe(403);
    expect(denied.text).not.toContain('private media bytes');
  });
});
