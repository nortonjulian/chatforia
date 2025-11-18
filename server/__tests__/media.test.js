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
    },
    participant: {
      findFirst: jest.fn(),
    },
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

    expect(consoleSpy).toHaveBeenCalledWith('R2 upload failed:', err);
    consoleSpy.mockRestore();
  });
});

describe('GET /media/signed-url', () => {
  test('returns 400 when key is missing', async () => {
    const res = await request(app)
      .get('/media/signed-url')
      .set('x-test-user-id', '1');

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'Missing key' });
  });

  test('returns 404 when attachment not found', async () => {
    prismaMock.messageAttachment.findFirst.mockResolvedValueOnce(null);

    const res = await request(app)
      .get('/media/signed-url')
      .query({ key: 'uploads/u1/file.png' })
      .set('x-test-user-id', '1');

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'Attachment not found' });
  });

  test('returns 403 when user is not a participant and not admin', async () => {
    prismaMock.messageAttachment.findFirst.mockResolvedValueOnce({
      id: 10,
      url: 'https://media/u1/file.png',
      message: { chatRoomId: 99 },
    });
    prismaMock.participant.findFirst.mockResolvedValueOnce(null);

    const res = await request(app)
      .get('/media/signed-url')
      .query({ key: 'uploads/u1/file.png' })
      .set('x-test-user-id', '2')
      .set('x-test-role', 'USER');

    expect(res.status).toBe(403);
    expect(res.body).toEqual({ error: 'Forbidden' });

    expect(prismaMock.participant.findFirst).toHaveBeenCalledWith({
      where: { chatRoomId: 99, userId: 2 },
      select: { id: true },
    });
  });

  test('returns signed URL when user is participant', async () => {
    prismaMock.messageAttachment.findFirst.mockResolvedValueOnce({
      id: 11,
      url: 'https://media/u3/file.png',
      message: { chatRoomId: 123 },
    });
    prismaMock.participant.findFirst.mockResolvedValueOnce({ id: 1 });
    r2PresignGetMock.mockResolvedValueOnce('https://signed.example.com/url');

    const res = await request(app)
      .get('/media/signed-url')
      .query({ key: 'uploads/u3/file.png' })
      .set('x-test-user-id', '3')
      .set('x-test-role', 'USER');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      url: 'https://signed.example.com/url',
      expiresSec: 180,
    });

    expect(r2PresignGetMock).toHaveBeenCalledWith({
      key: 'uploads/u3/file.png',
      expiresSec: 180,
    });
  });

  test('allows ADMIN without membership check', async () => {
    prismaMock.messageAttachment.findFirst.mockResolvedValueOnce({
      id: 12,
      url: 'https://media/u4/file.png',
      message: { chatRoomId: 777 },
    });
    // participant not needed; route should skip for ADMIN
    r2PresignGetMock.mockResolvedValueOnce('https://signed.admin/url');

    const res = await request(app)
      .get('/media/signed-url')
      .query({ key: 'uploads/u4/file.png' })
      .set('x-test-user-id', '4')
      .set('x-test-role', 'ADMIN');

    expect(res.status).toBe(200);
    expect(res.body.url).toBe('https://signed.admin/url');

    expect(prismaMock.participant.findFirst).not.toHaveBeenCalled();
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
