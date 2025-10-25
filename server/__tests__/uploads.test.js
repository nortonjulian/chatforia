/**
 * @jest-environment node
 */
import { jest } from '@jest/globals';
import fs from 'fs';
import path from 'path';
import os from 'os';
import request from 'supertest';
import prisma from '../utils/prismaClient.js';

// --- IMPORTANT: mock storage so GET can find files on disk ---
// Force the router's "fallback to local disk" path by throwing from storeBuffer.
// This mock MUST come before we import the app, so uploadsRouter uses it.
jest.mock('../services/storage/index.js', () => ({
  __esModule: true,
  default: {
    storeBuffer: jest.fn().mockImplementation(() => {
      throw new Error('simulate storage failure');
    }),
  },
}));

// We also don't want huge surprises from antivirus / thumb generators here.
// uploadsRouter itself doesn't call scanFile/ensureThumb, so we don't need to mock them in this file.
// If you later add them here, you'd mock like in messages-create.test.js.

// Now pull in the actual app that mounts /auth and /uploads.
import app from '../app.js';

describe('uploadsRouter', () => {
  let agent1;
  let agent2;
  let email1;
  let email2;
  let username1;
  let username2;
  const password = 'Password!23';

  beforeEach(async () => {
    // wipe DB rows that matter between tests
    try { await prisma.message.deleteMany({}); } catch {}
    try { await prisma.chatRoom.deleteMany({}); } catch {}
    try { await prisma.user.deleteMany({}); } catch {}

    // reset in-memory upload registry in router between tests?
    // We don't have direct access here, but tests don't require cross-test isolation of uploads
    // as long as we create new users each time.

    agent1 = request.agent(app);
    agent2 = request.agent(app);

    // unique per test so dedup/ACL don't collide across tests
    const stamp = Date.now() + '_' + Math.floor(Math.random() * 1e6);
    email1 = `user1_${stamp}@example.com`;
    email2 = `user2_${stamp}@example.com`;
    username1 = `user1_${stamp}`;
    username2 = `user2_${stamp}`;

    // Register & login user1
    await agent1
      .post('/auth/register')
      .send({ email: email1, username: username1, password })
      .then((res) => {
        if (![200, 201].includes(res.status)) {
          throw new Error(`Unexpected /auth/register (user1) status ${res.status}`);
        }
      });

    await agent1
      .post('/auth/login')
      .send({ identifier: email1, password })
      .then((res) => {
        if (res.status !== 200) {
          throw new Error(`Unexpected /auth/login (user1) status ${res.status}`);
        }
      });

    // Register & login user2
    await agent2
      .post('/auth/register')
      .send({ email: email2, username: username2, password })
      .then((res) => {
        if (![200, 201].includes(res.status)) {
          throw new Error(`Unexpected /auth/register (user2) status ${res.status}`);
        }
      });

    await agent2
      .post('/auth/login')
      .send({ identifier: email2, password })
      .then((res) => {
        if (res.status !== 200) {
          throw new Error(`Unexpected /auth/login (user2) status ${res.status}`);
        }
      });
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  test('GET /uploads/__iam_uploads_router returns health', async () => {
    const res = await agent1.get('/uploads/__iam_uploads_router').expect(200);
    expect(res.body).toEqual({ ok: true, router: 'uploads' });
  });

  test('POST /uploads without file returns 400', async () => {
    const res = await agent1.post('/uploads').expect(400);
    expect(res.body.error).toMatch(/file is required/i);
  });

  test('POST /uploads rejects oversized file (size limit)', async () => {
    // Router default is 10MB unless MAX_FILE_SIZE_BYTES is set.
    // Use >10MB so we always trigger 413.
    const bigBuffer = Buffer.alloc(12 * 1024 * 1024); // 12MB
    const res = await agent1
      .post('/uploads')
      .attach('file', bigBuffer, {
        filename: 'bigfile.bin',
        contentType: 'application/octet-stream',
      });
    expect(res.status).toBe(413);
    expect(res.body.error).toMatch(/File too large/i);
  });

  test('POST /uploads rejects banned executable type (.exe)', async () => {
    const res = await agent1
      .post('/uploads')
      .attach('file', Buffer.from('dummy'), {
        filename: 'malware.exe',
        contentType: 'application/x-msdownload',
      });
    expect(res.status).toBe(415);
    expect(res.body.error).toMatch(/Executable type not allowed/i);
  });

  test('POST /uploads rejects SVG file (blocked)', async () => {
    const svgData = Buffer.from('<svg><script>alert(1)</script></svg>');
    const res = await agent1
      .post('/uploads')
      .attach('file', svgData, {
        filename: 'script.svg',
        contentType: 'image/svg+xml',
      });
    expect(res.status).toBe(415);
    expect(res.body.error).toMatch(/SVG not allowed/i);
  });

  test('POST /uploads uploads PNG successfully and GET returns safe headers', async () => {
    // Make a tiny "PNG" body with the correct magic header so mime looks sane.
    const pngHeader = Buffer.from('89504e470d0a1a0a', 'hex'); // PNG signature bytes

    const up = await agent1
      .post('/uploads')
      .attach('file', pngHeader, {
        filename: `picture_${Date.now()}.png`,
        contentType: 'image/png',
      });

    // For a brand new file that isn't deduped, route returns 201.
    expect([200, 201].includes(up.status)).toBe(true);
    expect(up.body.id).toBeDefined();
    expect(up.body.mimeType).toMatch(/image\/png/);
    expect(up.body.name).toMatch(/\.png$/i);
    const id = up.body.id;

    const dl = await agent1.get(`/uploads/${id}`).expect(200);
    expect(dl.headers['content-type']).toMatch(/image\/png/);
    expect(dl.headers['content-disposition']).toMatch(/attachment/);
    expect(dl.headers['x-content-type-options']).toBe('nosniff');

    // supertest puts response body as Buffer if not JSON.
    expect(Buffer.isBuffer(dl.body)).toBe(true);
    expect(dl.body).toEqual(pngHeader);
  });

  test('GET /uploads/:id enforces owner-only access', async () => {
    const data = Buffer.from('owner-only-access-content');
    const uploadRes = await agent1
      .post('/uploads')
      .attach('file', data, {
        filename: `secret_${Date.now()}.txt`,
        contentType: 'text/plain',
      });
    expect([200, 201].includes(uploadRes.status)).toBe(true);

    const id = uploadRes.body.id;
    expect(id).toBeDefined();

    // A different logged-in user should NOT be able to fetch this.
    // Depending on timing and fallback, we might get 403 (forbidden) or 404 (file missing).
    const resp = await agent2.get(`/uploads/${id}`);
    expect([403, 404]).toContain(resp.status);
  });

  test('GET /uploads/:id invalid or non-existent ID', async () => {
    // Invalid ID
    await agent1.get('/uploads/not-a-number').expect(400);

    // Non-existent numeric ID → 403 Forbidden under our ACL logic
    const res = await agent1.get('/uploads/999999');
    expect([403, 404]).toContain(res.status);
    if (res.status === 403) {
      expect(res.body.error || '').toMatch(/Forbidden|no access/i);
    }
  });

  test('POST /uploads deduplication: re-upload returns existing id', async () => {
    const content = Buffer.from('this-is-some-file-content'); // > 9 bytes so dedup is enabled
    const first = await agent1
      .post('/uploads')
      .attach('file', content, {
        filename: `file1_${Date.now()}.txt`,
        contentType: 'text/plain',
      });
    expect([200, 201].includes(first.status)).toBe(true);
    const firstId = first.body.id;
    expect(firstId).toBeDefined();

    const second = await agent1
      .post('/uploads')
      .attach('file', content, {
        filename: `file2_${Date.now()}.txt`,
        contentType: 'text/plain',
      })
      .expect(200);

    expect(second.body.id).toBe(firstId);
    expect(second.body.dedup).toBe(true);
  });

  test('POST /uploads: same small content (<9 bytes) does not dedup', async () => {
    const small = Buffer.from('short'); // 5 bytes < DEDUP_MIN_BYTES (9)
    const r1 = await agent1
      .post('/uploads')
      .attach('file', small, {
        filename: `s1_${Date.now()}.txt`,
        contentType: 'text/plain',
      });
    expect([200, 201].includes(r1.status)).toBe(true);
    const id1 = r1.body.id;

    const r2 = await agent1
      .post('/uploads')
      .attach('file', small, {
        filename: `s2_${Date.now()}.txt`,
        contentType: 'text/plain',
      });
    expect([200, 201].includes(r2.status)).toBe(true);
    const id2 = r2.body.id;

    // small (<9 bytes) bypasses dedup logic, so ids should differ
    expect(id2).not.toBe(id1);
    expect(r2.body.dedup).toBeUndefined();
  });
});
