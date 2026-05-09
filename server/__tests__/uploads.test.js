/**
 * @jest-environment node
 */
import { jest } from '@jest/globals';
import express from 'express';
import request from 'supertest';

jest.mock('../services/storage/index.js', () => ({
  __esModule: true,
  default: {
    storeBuffer: jest.fn().mockImplementation(() => {
      throw new Error('simulate storage failure');
    }),
  },
}));

const { uploadsRouter } = await import('../routes/uploads.js');

function makeApp(userId = 1) {
  const app = express();

  app.use(express.json());

  app.use((req, _res, next) => {
    req.user = {
      id: userId,
      role: 'USER',
      plan: 'FREE',
    };
    next();
  });

  app.use('/uploads', uploadsRouter);

  app.use((err, _req, res, _next) => {
    if (err?.isBoom) {
      return res.status(err.output.statusCode).json(err.output.payload);
    }

    return res.status(err.status || 500).json({
      error: err.message || 'Internal server error',
    });
  });

  return app;
}

describe('uploadsRouter', () => {
  let agent1;
  let agent2;

  beforeEach(() => {
    jest.clearAllMocks();

    agent1 = request.agent(makeApp(1));
    agent2 = request.agent(makeApp(2));
  });

  test('GET /uploads/__iam_uploads_router returns health', async () => {
    const res = await agent1.get('/uploads/__iam_uploads_router').expect(200);

    expect(res.body).toEqual({
      ok: true,
      router: 'uploads',
    });
  });

  test('POST /uploads without file returns 400', async () => {
    const res = await agent1.post('/uploads').expect(400);

    expect(res.body.error).toMatch(/file is required/i);
  });

  test('POST /uploads rejects oversized file (size limit)', async () => {
    const bigBuffer = Buffer.alloc(12 * 1024 * 1024);

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
    const pngHeader = Buffer.from('89504e470d0a1a0a', 'hex');

    const up = await agent1
      .post('/uploads')
      .attach('file', pngHeader, {
        filename: `picture_${Date.now()}.png`,
        contentType: 'image/png',
      });

    expect([200, 201]).toContain(up.status);
    expect(up.body.id).toBeDefined();
    expect(up.body.mimeType).toMatch(/image\/png/);
    expect(up.body.name).toMatch(/\.png$/i);

    const id = up.body.id;

    const dl = await agent1.get(`/uploads/${id}`).expect(200);

    expect(dl.headers['content-type']).toMatch(/image\/png/);
    expect(dl.headers['content-disposition']).toMatch(/attachment/);
    expect(dl.headers['x-content-type-options']).toBe('nosniff');

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

    expect([200, 201]).toContain(uploadRes.status);

    const id = uploadRes.body.id;

    expect(id).toBeDefined();

    const resp = await agent2.get(`/uploads/${id}`);

    expect([403, 404]).toContain(resp.status);
  });

  test('GET /uploads/:id invalid or non-existent ID', async () => {
    await agent1.get('/uploads/not-a-number').expect(400);

    const res = await agent1.get('/uploads/999999');

    expect([403, 404]).toContain(res.status);

    if (res.status === 403) {
      expect(res.body.error || '').toMatch(/Forbidden|no access/i);
    }
  });

  test('POST /uploads deduplication: re-upload returns existing id', async () => {
    const content = Buffer.from('this-is-some-file-content');

    const first = await agent1
      .post('/uploads')
      .attach('file', content, {
        filename: `file1_${Date.now()}.txt`,
        contentType: 'text/plain',
      });

    expect([200, 201]).toContain(first.status);

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
    const small = Buffer.from('short');

    const r1 = await agent1
      .post('/uploads')
      .attach('file', small, {
        filename: `s1_${Date.now()}.txt`,
        contentType: 'text/plain',
      });

    expect([200, 201]).toContain(r1.status);

    const id1 = r1.body.id;

    const r2 = await agent1
      .post('/uploads')
      .attach('file', small, {
        filename: `s2_${Date.now()}.txt`,
        contentType: 'text/plain',
      });

    expect([200, 201]).toContain(r2.status);

    const id2 = r2.body.id;

    expect(id2).not.toBe(id1);
    expect(r2.body.dedup).toBeUndefined();
  });
});