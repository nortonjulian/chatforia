import { jest } from '@jest/globals';
import express from 'express';
import request from 'supertest';

process.env.R2_BUCKET = 'chatforia-qa-test-bucket';

const pendingRecords = new Map();

const mockPrisma = {
  pendingUpload: {
    create: jest.fn(async ({ data }) => {
      const record = {
        id: `pending-${pendingRecords.size + 1}`,
        completedUploadId: null,
        ...data,
      };
      pendingRecords.set(data.key, record);
      return record;
    }),
    findUnique: jest.fn(async ({ where }) =>
      pendingRecords.get(where.key) ?? null
    ),
  },
};

const mockStorage = {
  generatePresignedPutUrl: jest.fn(async ({
    key,
    expiresIn,
  }) => ({
    url: 'https://storage.example.test/upload',
    key,
    expiresIn,
  })),
  headStorageObject: jest.fn(async ({ key }) => {
    const pending = pendingRecords.get(key);
    if (!pending) throw new Error('Object missing');
    return {
      key,
      size: pending.expectedSize,
      contentType: pending.mimeType,
    };
  }),
  deleteStorageObject: jest.fn(),
  buildPublicUrlForKey: jest.fn(
    (key) => `https://storage.example.test/${key}`
  ),
};

const mockFinalize = jest.fn(async ({
  userId,
  key,
  actualSize,
  actualMimeType,
}) => ({
  upload: {
    id: 501,
    ownerId: userId,
    key,
    size: actualSize,
    mimeType: actualMimeType,
    originalName: 'video.mp4',
  },
  alreadyCompleted: false,
}));

jest.unstable_mockModule('../utils/prismaClient.js', () => ({
  default: mockPrisma,
}));

jest.unstable_mockModule('../utils/storage.js', () => ({
  ...mockStorage,
}));

jest.unstable_mockModule('../services/cloudStorageService.js', () => ({
  assertCloudStorageAvailable: jest.fn(),
  createUploadWithinCloudStorageAllowance: jest.fn(),
  finalizePendingUploadWithinCloudStorageAllowance: mockFinalize,
}));

jest.unstable_mockModule('../services/storage/index.js', () => ({
  default: { storeBuffer: jest.fn() },
}));

const { uploadsRouter } = await import('../routes/uploads.js');

function appFor(userId) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.user = { id: userId, role: 'USER', plan: 'FREE' };
    next();
  });
  app.use('/uploads', uploadsRouter);
  return app;
}

describe('presigned upload HTTP security', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    pendingRecords.clear();
  });

  const intentBody = {
    name: 'video.mp4',
    mimeType: 'video/mp4',
    size: 1000,
  };

  test('creates a durable authorization before returning upload URL', async () => {
    const res = await request(appFor(7))
      .post('/uploads/intent')
      .send(intentBody);

    expect(res.status).toBe(200);
    expect(res.body.key).toMatch(/^uploads\/u7\//);

    expect(mockPrisma.pendingUpload.create)
      .toHaveBeenCalledWith({
        data: expect.objectContaining({
          ownerId: 7,
          key: res.body.key,
          mimeType: 'video/mp4',
          expectedSize: 1000,
          expiresAt: expect.any(Date),
        }),
      });

    expect(res.body.uploadUrl).toBeDefined();
  });

  test('signs an opt-in create-only upload', async () => {
    const res = await request(appFor(7))
      .post('/uploads/intent')
      .send({ ...intentBody, createOnly: true });

    expect(res.status).toBe(200);

    expect(mockStorage.generatePresignedPutUrl)
      .toHaveBeenCalledWith(
        expect.objectContaining({
          contentType: 'video/mp4',
          createOnly: true,
        })
      );

    expect(res.body.uploadHeaders).toEqual({
      'Content-Type': 'video/mp4',
      'If-None-Match': '*',
    });
  });

  test('preserves legacy signing for clients without createOnly', async () => {
    const res = await request(appFor(7))
      .post('/uploads/intent')
      .send(intentBody);

    expect(res.status).toBe(200);

    expect(mockStorage.generatePresignedPutUrl)
      .toHaveBeenCalledWith(
        expect.objectContaining({
          createOnly: false,
        })
      );

    expect(res.body.uploadHeaders).toEqual({
      'Content-Type': 'video/mp4',
    });
  });

  test('rejects a non-boolean createOnly flag', async () => {
    const res = await request(appFor(7))
      .post('/uploads/intent')
      .send({ ...intentBody, createOnly: 'true' });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_create_only');
    expect(mockStorage.generatePresignedPutUrl)
      .not.toHaveBeenCalled();
    expect(mockPrisma.pendingUpload.create)
      .not.toHaveBeenCalled();
  });

  test('completes a matching uploaded object', async () => {
    const app = appFor(7);

    const intent = await request(app)
      .post('/uploads/intent')
      .send(intentBody)
      .expect(200);

    const result = await request(app)
      .post('/uploads/complete')
      .send({
        key: intent.body.key,
        mimeType: 'video/mp4',
        size: 1000,
      });

    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({
      ok: true,
      file: {
        id: 501,
        key: intent.body.key,
        size: 1000,
        contentType: 'video/mp4',
      },
    });

    expect(mockFinalize).toHaveBeenCalledTimes(1);
  });

  test('rejects a stored object with mismatched size', async () => {
    const app = appFor(7);

    const intent = await request(app)
      .post('/uploads/intent')
      .send(intentBody)
      .expect(200);

    mockStorage.headStorageObject.mockResolvedValueOnce({
      key: intent.body.key,
      size: 999,
      contentType: 'video/mp4',
    });

    const res = await request(app)
      .post('/uploads/complete')
      .send({
        key: intent.body.key,
        mimeType: 'video/mp4',
        size: 1000,
      });

    expect(res.status).toBe(409);
    expect(res.body.error)
      .toBe('uploaded_object_metadata_mismatch');
    expect(mockFinalize).not.toHaveBeenCalled();
  });

  test('rejects a missing pending-upload authorization', async () => {
    const res = await request(appFor(7))
      .post('/uploads/complete')
      .send({
        key: 'uploads/u7/2026/10/29/unknown.mp4',
        mimeType: 'video/mp4',
        size: 1000,
      });

    expect(res.status).toBe(404);
    expect(mockFinalize).not.toHaveBeenCalled();
  });

  test('rejects an expired pending upload', async () => {
    const app = appFor(7);

    const intent = await request(app)
      .post('/uploads/intent')
      .send(intentBody)
      .expect(200);

    pendingRecords.get(intent.body.key).expiresAt =
      new Date(Date.now() - 60_000);

    const res = await request(app)
      .post('/uploads/complete')
      .send({
        key: intent.body.key,
        mimeType: 'video/mp4',
        size: 1000,
      });

    expect(res.status).toBe(410);
    expect(res.body.error).toBe('upload_intent_expired');
    expect(mockStorage.headStorageObject).not.toHaveBeenCalled();
    expect(mockFinalize).not.toHaveBeenCalled();
  });

  test('returns the completed upload without requesting R2 metadata again', async () => {
    const app = appFor(7);

    const intent = await request(app)
      .post('/uploads/intent')
      .send(intentBody)
      .expect(200);

    pendingRecords.get(intent.body.key).completedUploadId = 501;

    mockFinalize.mockResolvedValueOnce({
      upload: {
        id: 501,
        ownerId: 7,
        key: intent.body.key,
        size: 1000,
        mimeType: 'video/mp4',
        originalName: 'video.mp4',
      },
      alreadyCompleted: true,
    });

    const res = await request(app)
      .post('/uploads/complete')
      .send({
        key: intent.body.key,
        mimeType: 'video/mp4',
        size: 1000,
      });

    expect(res.status).toBe(200);
    expect(res.body.file.id).toBe(501);
    expect(mockStorage.headStorageObject).not.toHaveBeenCalled();
    expect(mockFinalize).toHaveBeenCalledTimes(1);
  });

  test('rejects stored MIME type mismatch', async () => {
    const app = appFor(7);

    const intent = await request(app)
      .post('/uploads/intent')
      .send(intentBody)
      .expect(200);

    mockStorage.headStorageObject.mockResolvedValueOnce({
      key: intent.body.key,
      size: 1000,
      contentType: 'application/octet-stream',
    });

    const res = await request(app)
      .post('/uploads/complete')
      .send({
        key: intent.body.key,
        mimeType: 'video/mp4',
        size: 1000,
      });

    expect(res.status).toBe(409);
    expect(res.body.error)
      .toBe('uploaded_object_metadata_mismatch');
    expect(mockFinalize).not.toHaveBeenCalled();
  });

  test('rejects another user completing the upload', async () => {
    const intent = await request(appFor(7))
      .post('/uploads/intent')
      .send(intentBody)
      .expect(200);

    const res = await request(appFor(8))
      .post('/uploads/complete')
      .send({
        key: intent.body.key,
        mimeType: 'video/mp4',
        size: 1000,
      });

    expect(res.status).toBe(403);
    expect(mockFinalize).not.toHaveBeenCalled();
  });
});
