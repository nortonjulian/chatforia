import { jest, describe, it, expect, beforeEach } from '@jest/globals';
import express from 'express';
import request from 'supertest';

// --- Mocks -------------------------------------------------------------------

// prisma.story.create
const mockStoryCreate = jest.fn();

// AV scan
const mockScanFile = jest.fn();

// Thumbnailer
const mockEnsureThumb = jest.fn();

// Download token signer
const mockSignDownloadToken = jest.fn();

// Mock prisma client used by stories.js
jest.unstable_mockModule('../utils/prismaClient.js', () => ({
  default: {
    story: {
      create: mockStoryCreate,
    },
  },
}));

// Mock auth middleware: just attaches a user and calls next
jest.unstable_mockModule('../middleware/auth.js', () => ({
  requireAuth: (req, res, next) => {
    // can override in tests by setting req.user beforehand, if needed
    if (!req.user) req.user = { id: 123 };
    next();
  },
}));

// Mock uploadMedia so it doesn't try to parse multipart/form-data
jest.unstable_mockModule('../middleware/uploads.js', () => ({
  uploadMedia: {
    array: () => (req, res, next) => next(),
  },
}));

// Mock antivirus
jest.unstable_mockModule('../utils/antivirus.js', () => ({
  scanFile: mockScanFile,
}));

// Mock thumbnailer
jest.unstable_mockModule('../utils/thumbnailer.js', () => ({
  ensureThumb: mockEnsureThumb,
}));

// Mock downloadTokens
jest.unstable_mockModule('../utils/downloadTokens.js', () => ({
  signDownloadToken: mockSignDownloadToken,
}));

// Import router under test *after* mocks
const { default: storiesRouter } = await import('../routes/stories.js');

// --- Helper to build app -----------------------------------------------------

function createApp({ files = [], body = {}, user } = {}) {
  const app = express();

  // We manually inject body/files before hitting router
  app.use((req, res, next) => {
    req.body = { ...body };
    req.files = files;
    if (user) req.user = user;
    next();
  });

  app.use('/stories', storiesRouter);

  // Simple error handler that converts Boom errors to JSON
  app.use((err, req, res, next) => {
    if (err && err.isBoom && err.output) {
      return res
        .status(err.output.statusCode)
        .json(err.output.payload);
    }
    return res
      .status(500)
      .json({
        statusCode: 500,
        error: 'Internal Server Error',
        message: err?.message || 'Internal error',
      });
  });

  return app;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockScanFile.mockResolvedValue({ ok: true });
  mockEnsureThumb.mockResolvedValue({ rel: 'media/thumb-image-1' });
  mockSignDownloadToken.mockImplementation(({ path, ownerId }) => `signed-${ownerId}-${path}`);
});

// --- Tests -------------------------------------------------------------------

describe('POST /stories', () => {
  it('creates a story with image + audio, signs URLs, and persists meta', async () => {
    const now = Date.now();
    jest.spyOn(Date, 'now').mockReturnValue(now);

    const files = [
      // First file: image
      {
        path: '/tmp/image-1',
        mimetype: 'image/jpeg',
      },
      // Second file: audio
      {
        path: '/tmp/audio-1',
        mimetype: 'audio/mpeg',
      },
    ];

    const body = {
      caption: 'My story',
      expireSeconds: '60',
      attachmentsMeta: JSON.stringify([
        { idx: 1, kind: 'AUDIO', durationSec: 12.3 },
      ]),
    };

    // First story.create succeeds
    mockStoryCreate.mockResolvedValueOnce({
      id: 1,
      userId: 123,
      caption: 'My story',
      imageUrl: 'media/image-1',
      videoUrl: null,
      audioUrl: 'media/audio-1',
      audioMimeType: 'audio/mpeg',
      audioDurationSec: 12.3,
      thumbUrl: 'media/thumb-image-1',
      createdAt: new Date(now),
      expiresAt: new Date(now + 60 * 1000),
    });

    const app = createApp({ files, body, user: { id: 123 } });

    const res = await request(app)
      .post('/stories')
      .send(); // body already injected

    expect(res.statusCode).toBe(201);

    // Ensure prisma was called with expected shape
    expect(mockStoryCreate).toHaveBeenCalledTimes(1);
    const call = mockStoryCreate.mock.calls[0][0];
    expect(call.data.userId).toBe(123);
    expect(call.data.caption).toBe('My story');
    expect(call.data.imageUrl).toBe('media/image-1');
    expect(call.data.videoUrl).toBeNull();
    expect(call.data.audioUrl).toBe('media/audio-1');
    expect(call.data.audioMimeType).toBe('audio/mpeg');
    expect(call.data.audioDurationSec).toBe(12.3);
    expect(call.data.thumbUrl).toBe('media/thumb-image-1');
    // TTL ~60s
    expect(call.data.expiresAt.getTime()).toBe(now + 60 * 1000);

    // Virus scan was called for each file
    expect(mockScanFile).toHaveBeenCalledTimes(2);
    expect(mockScanFile).toHaveBeenCalledWith('/tmp/image-1');
    expect(mockScanFile).toHaveBeenCalledWith('/tmp/audio-1');

    // ensureThumb was called for the image
    expect(mockEnsureThumb).toHaveBeenCalledWith('/tmp/image-1', 'image-1');

    // URLs should be signed (wrapped in /files?token= and URL-encoded)
    expect(res.body.imageUrl).toBe(
      '/files?token=' + encodeURIComponent('signed-123-media/image-1'),
    );
    expect(res.body.audioUrl).toBe(
      '/files?token=' + encodeURIComponent('signed-123-media/audio-1'),
    );
    expect(res.body.thumbUrl).toBe(
      '/files?token=' + encodeURIComponent('signed-123-media/thumb-image-1'),
    );
    expect(res.body.videoUrl).toBeNull();

    expect(mockSignDownloadToken).toHaveBeenCalledWith({
      path: 'media/image-1',
      ownerId: 123,
      ttlSec: 300,
    });
  });

  it('creates an audio-only story when there is no visual media', async () => {
    const files = [
      {
        path: '/tmp/audio-only',
        mimetype: 'audio/ogg',
      },
    ];

    const body = {
      caption: 'Just audio',
      expireSeconds: '10',
      attachmentsMeta: JSON.stringify([
        { idx: 0, kind: 'AUDIO', durationSec: 5 },
      ]),
    };

    mockStoryCreate.mockResolvedValueOnce({
      id: 2,
      userId: 123,
      caption: 'Just audio',
      imageUrl: null,
      videoUrl: null,
      audioUrl: 'media/audio-only',
      audioMimeType: 'audio/ogg',
      audioDurationSec: 5,
      thumbUrl: null,
      createdAt: new Date(),
      expiresAt: new Date(),
    });

    const app = createApp({ files, body, user: { id: 123 } });

    const res = await request(app).post('/stories');

    expect(res.statusCode).toBe(201);
    expect(mockStoryCreate).toHaveBeenCalledTimes(1);

    const call = mockStoryCreate.mock.calls[0][0];
    expect(call.data.imageUrl).toBeNull();
    expect(call.data.videoUrl).toBeNull();
    expect(call.data.audioUrl).toBe('media/audio-only');
    expect(call.data.audioMimeType).toBe('audio/ogg');
    expect(call.data.audioDurationSec).toBe(5);

    expect(res.body.imageUrl).toBeNull();
    expect(res.body.videoUrl).toBeNull();
    expect(res.body.audioUrl).toBe(
      '/files?token=' + encodeURIComponent('signed-123-media/audio-only'),
    );
  });

  it('returns 400 when no valid media files are provided', async () => {
    // Empty files array -> no visualRel, no audioRel
    const app = createApp({ files: [], body: {}, user: { id: 123 } });

    const res = await request(app).post('/stories');

    expect(res.statusCode).toBe(400);
    expect(res.body.message).toMatch(/Provide at least one media file/i);
    expect(mockStoryCreate).not.toHaveBeenCalled();
  });

  it('skips files that fail antivirus and still creates a story from the remaining ones', async () => {
    const files = [
      {
        path: '/tmp/bad-image',
        mimetype: 'image/jpeg',
      },
      {
        path: '/tmp/good-image',
        mimetype: 'image/png',
      },
    ];

    // First file fails AV, second passes
    mockScanFile
      .mockResolvedValueOnce({ ok: false })
      .mockResolvedValueOnce({ ok: true });

    mockStoryCreate.mockResolvedValueOnce({
      id: 3,
      userId: 123,
      caption: '',
      imageUrl: 'media/good-image',
      videoUrl: null,
      audioUrl: null,
      audioMimeType: null,
      audioDurationSec: null,
      thumbUrl: 'media/thumb-image-1',
      createdAt: new Date(),
      expiresAt: new Date(),
    });

    const app = createApp({ files, body: {}, user: { id: 123 } });

    const res = await request(app).post('/stories');

    expect(res.statusCode).toBe(201);
    expect(mockScanFile).toHaveBeenCalledTimes(2);
    // We ended up using only the second file as visual
    const call = mockStoryCreate.mock.calls[0][0];
    expect(call.data.imageUrl).toBe('media/good-image');
  });

  it('falls back to minimal create when the first prisma call throws', async () => {
    const files = [
      {
        path: '/tmp/image-1',
        mimetype: 'image/jpeg',
      },
    ];

    // First create throws, second succeeds
    mockStoryCreate
      .mockRejectedValueOnce(new Error('schema mismatch'))
      .mockResolvedValueOnce({
        id: 4,
        userId: 123,
        caption: '',
        imageUrl: 'media/image-1',
        videoUrl: null,
        audioUrl: null,
        createdAt: new Date(),
        expiresAt: new Date(),
      });

    const app = createApp({ files, body: {}, user: { id: 123 } });

    const res = await request(app).post('/stories');

    expect(res.statusCode).toBe(201);
    expect(mockStoryCreate).toHaveBeenCalledTimes(2);

    const [firstCall, secondCall] = mockStoryCreate.mock.calls;
    expect(firstCall[0].data).toHaveProperty('audioMimeType');
    expect(secondCall[0].data).not.toHaveProperty('audioMimeType');

    // Response still has signed URL (with encoded token)
    expect(res.body.imageUrl).toBe(
      '/files?token=' + encodeURIComponent('signed-123-media/image-1'),
    );
  });

  it('returns 500 if something unexpected blows up before Boom wrapping', async () => {
    const files = [
      {
        path: '/tmp/image-1',
        mimetype: 'image/jpeg',
      },
    ];

    // Make scanFile throw to simulate an internal error
    mockScanFile.mockRejectedValueOnce(new Error('AV crashed'));

    const app = createApp({ files, body: {}, user: { id: 123 } });

    const res = await request(app).post('/stories');

    expect(res.statusCode).toBe(500);
    expect(res.body.error).toBe('Internal Server Error');
  });
});
