// __tests__/files.test.js
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
import { Readable } from 'stream';

const ORIGINAL_ENV = process.env;

let verifyDownloadTokenMock;
let fsStatMock;
let fsCreateReadStreamMock;
let mimeLookupMock;

// -------------------- Mocks --------------------

// Boom
await jest.unstable_mockModule('@hapi/boom', () => {
  const makeErr = (msg, statusCode) => {
    const err = new Error(msg);
    err.output = { statusCode };
    return err;
  };

  return {
    __esModule: true,
    default: {
      badRequest: (msg) => makeErr(msg, 400),
      forbidden: (msg) => makeErr(msg, 403),
      notFound: (msg) => makeErr(msg, 404),
    },
  };
});

// verifyDownloadToken
await jest.unstable_mockModule('../utils/downloadTokens.js', () => {
  verifyDownloadTokenMock = jest.fn();
  return {
    __esModule: true,
    verifyDownloadToken: verifyDownloadTokenMock,
  };
});

// fs
await jest.unstable_mockModule('fs', () => {
  fsStatMock = jest.fn();
  fsCreateReadStreamMock = jest.fn();

  return {
    __esModule: true,
    default: {
      promises: {
        stat: fsStatMock,
      },
      createReadStream: fsCreateReadStreamMock,
    },
  };
});

// mime-types
await jest.unstable_mockModule('mime-types', () => {
  mimeLookupMock = jest.fn();
  return {
    __esModule: true,
    default: {
      lookup: mimeLookupMock,
    },
  };
});

// requireAuth → inject user from headers
await jest.unstable_mockModule('../middleware/auth.js', () => ({
  __esModule: true,
  requireAuth: (req, _res, next) => {
    const id = Number(req.headers['x-test-user-id'] || '1');
    const role = String(req.headers['x-test-role'] || 'USER');
    req.user = { id, role };
    next();
  },
}));

// Import router AFTER mocks
const { default: filesRouter } = await import('../routes/files.js');

// Build test app
const app = express();
app.use('/files', filesRouter);

beforeEach(() => {
  jest.clearAllMocks();
  process.env = {
    ...ORIGINAL_ENV,
    UPLOADS_DIR: '/safe',
  };
});

afterAll(() => {
  process.env = ORIGINAL_ENV;
});

// -------------------- Tests --------------------

describe('GET /files', () => {
  test('400 when token is missing', async () => {
    const res = await request(app)
      .get('/files')
      .set('x-test-user-id', '10');

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'token required' });
    expect(verifyDownloadTokenMock).not.toHaveBeenCalled();
  });

  test('403 when payload owner does not match user and user is not ADMIN', async () => {
    verifyDownloadTokenMock.mockReturnValue({
      p: 'docs/file.txt',
      o: 999, // ownerId from token
      u: 999,
    });

    const res = await request(app)
      .get('/files')
      .query({ token: 'tok-1' })
      .set('x-test-user-id', '10') // different user
      .set('x-test-role', 'USER');

    expect(res.status).toBe(403);
    expect(res.body).toEqual({ error: 'forbidden' });

    expect(verifyDownloadTokenMock).toHaveBeenCalledWith('tok-1');
    expect(fsStatMock).not.toHaveBeenCalled();
  });

  test('403 when resolved path escapes storage root', async () => {
    verifyDownloadTokenMock.mockReturnValue({
      p: '../evil.txt', // path escape attempt
      o: 42,
      u: 42,
    });

    const res = await request(app)
      .get('/files')
      .query({ token: 'tok-2' })
      .set('x-test-user-id', '42')
      .set('x-test-role', 'USER');

    expect(res.status).toBe(403);
    expect(res.body).toEqual({ error: 'bad path' });

    expect(verifyDownloadTokenMock).toHaveBeenCalledWith('tok-2');
    expect(fsStatMock).not.toHaveBeenCalled();
  });

  test('404 when file does not exist or is not a file', async () => {
    verifyDownloadTokenMock.mockReturnValue({
      p: 'docs/missing.txt',
      o: 5,
      u: 5,
    });

    fsStatMock.mockResolvedValueOnce(null); // simulate missing

    const res = await request(app)
      .get('/files')
      .query({ token: 'tok-3' })
      .set('x-test-user-id', '5');

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'not found' });

    expect(fsStatMock).toHaveBeenCalledTimes(1);
    expect(fsCreateReadStreamMock).not.toHaveBeenCalled();
  });

  test('200 and streams file with correct headers (inline for image)', async () => {
    verifyDownloadTokenMock.mockReturnValue({
      p: 'images/photo.png',
      o: 7,
      u: 7,
    });

    fsStatMock.mockResolvedValueOnce({
      size: 11,
      isFile: () => true,
    });

    mimeLookupMock.mockReturnValue('image/png');

    const data = 'hello world';
    fsCreateReadStreamMock.mockReturnValueOnce(Readable.from([data]));

    const res = await request(app)
      .get('/files')
      .query({ token: 'tok-4' })
      .set('x-test-user-id', '7');

    expect(res.status).toBe(200);

    // For binary content-types, supertest puts data in res.body (Buffer), not res.text
    expect(Buffer.isBuffer(res.body)).toBe(true);
    expect(res.body.toString()).toBe(data);

    // Headers
    expect(res.headers['content-type']).toContain('image/png');
    expect(res.headers['content-length']).toBe('11');
    expect(res.headers['content-disposition']).toBe(
      'inline; filename="photo.png"',
    );
    expect(res.headers['cache-control']).toBe('private, max-age=120');

    // fs usage
    expect(fsStatMock).toHaveBeenCalledTimes(1);
    expect(fsCreateReadStreamMock).toHaveBeenCalledTimes(1);
  });
});
