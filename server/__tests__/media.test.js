import {
  jest,
  describe,
  test,
  expect,
  beforeEach,
  afterAll,
} from '@jest/globals';
import express from 'express';
import request from 'supertest';

const ORIGINAL_ENV = process.env;

// Force signed mode for tests (REQUIRE_SIGNED = true, PUBLIC_BASE empty)
process.env = {
  ...ORIGINAL_ENV,
  R2_REQUIRE_SIGNED: 'true',
  R2_PUBLIC_BASE: '',
  R2_SIGNED_EXPIRES_SEC: '180',
};

let prismaMock;
let r2PutObjectMock;
let r2PresignGetMock;

// For mocking multer’s behavior
let currentFile;
let currentMulterError;

// -------------------- Mocks --------------------

// prisma client
await jest.unstable_mockModule('../utils/prismaClient.js', () => {
  prismaMock = {
    messageAttachment: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
      findUnique: jest.fn(),
    },
    participant: {
      findFirst: jest.fn(),
      findUnique: jest.fn(),
    },
    threadState: { findUnique: jest.fn(async () => null) },
  };
  return {
    __esModule: true,
    default: prismaMock,
  };
});

// r2 helpers
await jest.unstable_mockModule('../utils/r2.js', () => {
  r2PutObjectMock = jest.fn();
  r2PresignGetMock = jest.fn();
  return {
    __esModule: true,
    r2PutObject: r2PutObjectMock,
    r2PresignGet: r2PresignGetMock,
  };
});

// auth middleware → inject user from headers
await jest.unstable_mockModule('../middleware/auth.js', () => ({
  __esModule: true,
  requireAuth: (req, _res, next) => {
    const id = Number(req.headers['x-test-user-id'] || '1');
    const role = String(req.headers['x-test-role'] || 'USER');
    req.user = { id, role };
    next();
  },
}));

// multer → fake single('file') middleware using our test globals
await jest.unstable_mockModule('multer', () => {
  const multerFn = jest.fn((_opts) => ({
    single: (_fieldName) =>
      (req, _res, cb) => {
        if (currentMulterError) {
          return cb(currentMulterError);
        }
        if (currentFile) {
          req.file = currentFile;
        }
        return cb(null);
      },
  }));

  multerFn.memoryStorage = jest.fn(() => ({}));

  return {
    __esModule: true,
    default: multerFn,
  };
});

// Import router AFTER mocks
const { default: mediaRouter } = await import('../routes/media.js');

// Build app
const app = express();
app.use('/media', mediaRouter);

beforeEach(() => {
  jest.clearAllMocks();
  currentFile = null;
  currentMulterError = null;
});

afterAll(() => {
  process.env = ORIGINAL_ENV;
});

// -------------------- Tests --------------------

describe('POST /media/upload', () => {
  test('uploads file and returns signed URL in signed mode', async () => {
    currentFile = {
      originalname: 'photo.jpg',
      mimetype: 'image/jpeg',
      buffer: Buffer.from('fake-binary'),
      size: 1234,
    };
    r2PutObjectMock.mockResolvedValueOnce(undefined);
    r2PresignGetMock.mockResolvedValueOnce('https://signed.example.com/obj');

    const res = await request(app)
      .post('/media/upload')
      .set('x-test-user-id', '42')
      .set('x-test-role', 'USER');

    expect(res.status).toBe(200);
    expect(r2PutObjectMock).toHaveBeenCalledTimes(1);
    const putArg = r2PutObjectMock.mock.calls[0][0];
    expect(putArg).toMatchObject({
      contentType: 'image/jpeg',
      body: expect.any(Buffer),
      key: expect.stringMatching(/^uploads\/u42\//),
    });

    expect(r2PresignGetMock).toHaveBeenCalledTimes(1);
    const presignArg = r2PresignGetMock.mock.calls[0][0];
    expect(presignArg).toEqual({
      key: putArg.key,
      expiresSec: 180,
    });

    expect(res.body).toEqual({
      ok: true,
      key: putArg.key,
      url: 'https://signed.example.com/obj',
      access: 'signed',
      expiresSec: 180,
      contentType: 'image/jpeg',
      size: 1234,
    });
  });

  test('returns 413 when multer reports file too large', async () => {
    currentMulterError = new Error('File too large');

    const res = await request(app)
      .post('/media/upload')
      .set('x-test-user-id', '5');

    expect(res.status).toBe(413);
    expect(res.body).toEqual({ error: 'File too large' });

    expect(r2PutObjectMock).not.toHaveBeenCalled();
    expect(r2PresignGetMock).not.toHaveBeenCalled();
  });

  test('returns 400 for unsupported file type', async () => {
    currentMulterError = new Error('Unsupported file type');

    const res = await request(app)
      .post('/media/upload')
      .set('x-test-user-id', '5');

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'Unsupported file type' });

    expect(r2PutObjectMock).not.toHaveBeenCalled();
  });

  test('returns 400 when no file is uploaded', async () => {
    // no currentFile and no error → middleware passes, but req.file undefined
    const res = await request(app)
      .post('/media/upload')
      .set('x-test-user-id', '7');

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'No file uploaded' });

    expect(r2PutObjectMock).not.toHaveBeenCalled();
  });

  test('returns 500 when r2PutObject throws', async () => {
    currentFile = {
      originalname: 'bad.png',
      mimetype: 'image/png',
      buffer: Buffer.from('bad'),
      size: 100,
    };
    const err = new Error('R2 down');
    r2PutObjectMock.mockRejectedValueOnce(err);

    const consoleSpy = jest
      .spyOn(console, 'error')
      .mockImplementation(() => {});

    const res = await request(app)
      .post('/media/upload')
      .set('x-test-user-id', '8');

    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: 'Upload failed' });

    expect(consoleSpy).toHaveBeenCalledWith(
      'R2 upload failed:',
      'Error',
      'R2 down',
    );

    expect(consoleSpy).toHaveBeenCalledWith(err);
        consoleSpy.mockRestore();
      });
    });

describe('GET /media/signed-url', () => {
  const key = 'uploads/u3/file.png';
  const attachment = () => ({
    id: 11, url: key, deletedAt: null,
    message: {
      id: 100, chatRoomId: 123, senderId: 3,
      createdAt: new Date('2026-01-01'), expiresAt: null,
      deletedForAll: false, deletedBySender: false, deletions: [],
    },
  });
  const get = () => request(app).get('/media/signed-url')
    .query({ key }).set('x-test-user-id', '3');

  test('rejects absent and malformed keys', async () => {
    expect((await request(app).get('/media/signed-url').set('x-test-user-id', '3')).status).toBe(400);
    expect((await request(app).get('/media/signed-url')
      .query({ key: '../secret' }).set('x-test-user-id', '3')).status).toBe(400);
  });
  test('missing attachment cannot issue a grant', async () => {
    prismaMock.messageAttachment.findMany.mockResolvedValueOnce([]);
    expect((await get()).status).toBe(404);
    expect(r2PresignGetMock).not.toHaveBeenCalled();
  });
  test('authorized participant gets private-media capability, not R2 signed URL', async () => {
    prismaMock.messageAttachment.findMany.mockResolvedValueOnce([{ id: 11 }]);
    prismaMock.messageAttachment.findUnique.mockResolvedValueOnce(attachment());
    prismaMock.participant.findUnique.mockResolvedValueOnce({ id: 2, clearedAt: null });
    const res = await get();
    expect(res.status).toBe(200);
    expect(res.body.url).toMatch(/^\/private-media\/file\?token=/);
    expect(res.body.expiresSec).toBe(60);
    expect(res.headers['cache-control']).toContain('no-store');
    expect(r2PresignGetMock).not.toHaveBeenCalled();
  });
  test('stranger, deleted message and mismatched key never get a grant', async () => {
    for (const failure of ['stranger', 'deleted', 'mismatched']) {
      const row = attachment();
      if (failure === 'deleted') row.message.deletedForAll = true;
      if (failure === 'mismatched') row.url = 'uploads/u3/another.png';
      prismaMock.messageAttachment.findMany.mockResolvedValueOnce([{ id: 11 }]);
      prismaMock.messageAttachment.findUnique.mockResolvedValueOnce(row);
      prismaMock.participant.findUnique.mockResolvedValueOnce(
        failure === 'stranger' ? null : { id: 2, clearedAt: null }
      );
      expect((await get()).status).toBe(404);
    }
    expect(r2PresignGetMock).not.toHaveBeenCalled();
  });
});

describe('GET /media/chatrooms/:id/media', () => {
  test('returns 403 when user is not a participant and not admin', async () => {
    prismaMock.participant.findFirst.mockResolvedValueOnce(null);

    const res = await request(app)
      .get('/media/chatrooms/55/media')
      .set('x-test-user-id', '10')
      .set('x-test-role', 'USER');

    expect(res.status).toBe(403);
    expect(res.body).toEqual({ error: 'Forbidden' });
  });

  test('returns media rows when user is a participant', async () => {
    prismaMock.participant.findFirst.mockResolvedValueOnce({ id: 1 });

    const rows = [
      {
        id: 1,
        kind: 'image',
        url: 'https://media/u10/img1.png',
        mimeType: 'image/png',
        width: 800,
        height: 600,
        durationSec: null,
        caption: 'pic',
        createdAt: '2025-01-01T00:00:00.000Z',
        message: {
          id: 100,
          createdAt: '2025-01-01T00:00:00.000Z',
          sender: { id: 10, username: 'julian', avatarUrl: null },
        },
      },
    ];
    prismaMock.messageAttachment.findMany.mockResolvedValueOnce(rows);

    const res = await request(app)
      .get('/media/chatrooms/55/media')
      .set('x-test-user-id', '10')
      .set('x-test-role', 'USER');

    expect(res.status).toBe(200);
    expect(res.body).toEqual(rows);

    expect(prismaMock.messageAttachment.findMany).toHaveBeenCalledWith({
      where: { message: { chatRoomId: 55 } },
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
  });

  test('allows ADMIN even when not a participant', async () => {
    // participant.findFirst will be called and return null, but ADMIN bypasses
    prismaMock.participant.findFirst.mockResolvedValueOnce(null);
    prismaMock.messageAttachment.findMany.mockResolvedValueOnce([]);

    const res = await request(app)
      .get('/media/chatrooms/123/media')
      .set('x-test-user-id', '1')
      .set('x-test-role', 'ADMIN');

    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });
});
