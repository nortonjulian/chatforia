import { jest } from '@jest/globals';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const prismaPath = path.resolve(__dirname, '../utils/prismaClient.js');

const tx = {
  user: {
    findUnique: jest.fn(),
  },
  upload: {
    aggregate: jest.fn(),
    create: jest.fn(),
    findUnique: jest.fn(),
  },
  pendingUpload: {
    findUnique: jest.fn(),
    update: jest.fn(),
  },
  $executeRawUnsafe: jest.fn(),
};

const prisma = {
  user: {
    findUnique: jest.fn(),
  },
  upload: {
    aggregate: jest.fn(),
  },
  $transaction: jest.fn(async (fn) => fn(tx)),
};

jest.unstable_mockModule(prismaPath, () => ({
  __esModule: true,
  default: prisma,
}));

const {
  assertCloudStorageAvailable,
  createUploadWithinCloudStorageAllowance,
  finalizePendingUploadWithinCloudStorageAllowance,
} = await import('../services/cloudStorageService.js');

describe('cloudStorageService', () => {
  beforeEach(() => {
    jest.clearAllMocks();

    prisma.user.findUnique.mockResolvedValue({ plan: 'FREE' });
    prisma.upload.aggregate.mockResolvedValue({
      _sum: { size: 100 },
    });

    tx.user.findUnique.mockResolvedValue({ plan: 'FREE' });
    tx.upload.aggregate.mockResolvedValue({
      _sum: { size: 100 },
    });
    tx.$executeRawUnsafe.mockResolvedValue(1);
    tx.pendingUpload.findUnique.mockResolvedValue(null);
    tx.pendingUpload.update.mockResolvedValue({});
    tx.upload.findUnique.mockResolvedValue(null);
    tx.upload.create.mockResolvedValue({
      id: 55,
      ownerId: 7,
      key: 'user/7/a.png',
      sha256: 'a'.repeat(64),
      originalName: 'a.png',
      mimeType: 'image/png',
      size: 25,
      driver: 'local',
      createdAt: new Date(),
    });
  });

  test('allows an upload that fits the current plan storage allowance', async () => {
    await expect(
      assertCloudStorageAvailable({
        userId: 7,
        requestedBytes: 25,
      }),
    ).resolves.toMatchObject({
      used: 100,
      requested: 25,
      after: 125,
    });
  });

  test('rejects an upload that would exceed the current storage allowance', async () => {
    prisma.upload.aggregate.mockResolvedValue({
      _sum: { size: 1024 ** 3 - 5 },
    });

    await expect(
      assertCloudStorageAvailable({
        userId: 7,
        requestedBytes: 10,
      }),
    ).rejects.toMatchObject({
      code: 'STORAGE_ALLOWANCE_EXCEEDED',
      status: 413,
      remaining: 5,
    });
  });

  test('serializes durable upload creation with a per-user advisory lock', async () => {
    const result = await createUploadWithinCloudStorageAllowance({
      userId: 7,
      uploadData: {
        ownerId: 7,
        key: 'user/7/a.png',
        sha256: 'a'.repeat(64),
        originalName: 'a.png',
        mimeType: 'image/png',
        size: 25,
        driver: 'local',
      },
    });

    expect(tx.$executeRawUnsafe).toHaveBeenCalledWith(
      'SELECT pg_advisory_xact_lock($1)',
      7,
    );

    expect(tx.upload.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          ownerId: 7,
          size: 25,
        }),
      }),
    );

    expect(result.upload.id).toBe(55);
  });

  test('does not create a durable upload row when the hard quota check fails', async () => {
    tx.upload.aggregate.mockResolvedValue({
      _sum: { size: 1024 ** 3 },
    });

    await expect(
      createUploadWithinCloudStorageAllowance({
        userId: 7,
        uploadData: {
          ownerId: 7,
          key: 'user/7/b.png',
          sha256: 'b'.repeat(64),
          originalName: 'b.png',
          mimeType: 'image/png',
          size: 1,
          driver: 'local',
        },
      }),
    ).rejects.toMatchObject({
      code: 'STORAGE_ALLOWANCE_EXCEEDED',
      status: 413,
    });

    expect(tx.upload.create).not.toHaveBeenCalled();
  });
});

describe('pending upload finalization', () => {
  const key = 'uploads/u7/2026/10/29/test-video.mp4';
  const digest = 'c'.repeat(64);

  const makePending = (overrides = {}) => ({
    id: 'pending-1',
    ownerId: 7,
    key,
    originalName: 'test-video.mp4',
    mimeType: 'video/mp4',
    expectedSize: 25,
    expiresAt: new Date(Date.now() + 60_000),
    completedAt: null,
    completedUploadId: null,
    ...overrides,
  });

  const finalize = (overrides = {}) =>
    finalizePendingUploadWithinCloudStorageAllowance({
      userId: 7,
      key,
      actualSize: 25,
      actualMimeType: 'video/mp4',
      sha256: digest,
      ...overrides,
    });

  beforeEach(() => {
    jest.clearAllMocks();

    tx.$executeRawUnsafe.mockResolvedValue(1);
    tx.user.findUnique.mockResolvedValue({ plan: 'FREE' });
    tx.upload.aggregate.mockResolvedValue({ _sum: { size: 100 } });

    tx.pendingUpload.findUnique.mockResolvedValue(makePending());
    tx.pendingUpload.update.mockResolvedValue({});

    tx.upload.create.mockResolvedValue({
      id: 900,
      ownerId: 7,
      key,
      originalName: 'test-video.mp4',
      mimeType: 'video/mp4',
      size: 25,
      sha256: digest,
      driver: 's3',
    });

    tx.upload.findUnique.mockResolvedValue(null);
    prisma.$transaction.mockImplementation(async (fn) => fn(tx));
  });

  test('finalizes exactly once and links the completed upload', async () => {
    const result = await finalize();

    expect(result).toMatchObject({
      alreadyCompleted: false,
      upload: { id: 900, ownerId: 7, key },
    });

    expect(tx.$executeRawUnsafe).toHaveBeenCalledWith(
      'SELECT pg_advisory_xact_lock($1)',
      7,
    );

    expect(tx.pendingUpload.findUnique).toHaveBeenCalledWith({
      where: { key },
    });

    expect(tx.upload.create).toHaveBeenCalledTimes(1);
    expect(tx.upload.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        ownerId: 7,
        key,
        mimeType: 'video/mp4',
        size: 25,
        sha256: digest,
      }),
    });

    expect(tx.pendingUpload.update).toHaveBeenCalledWith({
      where: { id: 'pending-1' },
      data: {
        completedAt: expect.any(Date),
        completedUploadId: 900,
      },
    });

    expect(
      tx.$executeRawUnsafe.mock.invocationCallOrder[0]
    ).toBeLessThan(
      tx.pendingUpload.findUnique.mock.invocationCallOrder[0]
    );
  });

  test('returns the original upload on retry without creating another', async () => {
    tx.pendingUpload.findUnique.mockResolvedValue(
      makePending({
        completedUploadId: 900,
        completedAt: new Date(),
        expiresAt: new Date(Date.now() - 60_000),
      })
    );

    tx.upload.findUnique.mockResolvedValue({
      id: 900,
      ownerId: 7,
      key,
      mimeType: 'video/mp4',
      size: 25,
    });

    const result = await finalize({
      actualSize: undefined,
      actualMimeType: undefined,
    });

    expect(result.alreadyCompleted).toBe(true);
    expect(result.upload.id).toBe(900);
    expect(tx.upload.create).not.toHaveBeenCalled();
    expect(tx.pendingUpload.update).not.toHaveBeenCalled();
    expect(tx.upload.aggregate).not.toHaveBeenCalled();
  });

  test('rejects an upload belonging to another owner', async () => {
    tx.pendingUpload.findUnique.mockResolvedValue(
      makePending({ ownerId: 8 })
    );

    await expect(finalize()).rejects.toMatchObject({
      code: 'UPLOAD_INTENT_NOT_FOUND',
    });

    expect(tx.upload.create).not.toHaveBeenCalled();
    expect(tx.pendingUpload.update).not.toHaveBeenCalled();
  });

  test('rejects an expired pending authorization', async () => {
    tx.pendingUpload.findUnique.mockResolvedValue(
      makePending({
        expiresAt: new Date(Date.now() - 60_000),
      })
    );

    await expect(finalize()).rejects.toMatchObject({
      code: 'UPLOAD_INTENT_EXPIRED',
    });

    expect(tx.upload.create).not.toHaveBeenCalled();
  });

  test('rejects mismatched size or MIME type', async () => {
    await expect(
      finalize({ actualSize: 26 })
    ).rejects.toMatchObject({
      code: 'UPLOAD_METADATA_MISMATCH',
    });

    await expect(
      finalize({ actualMimeType: 'image/jpeg' })
    ).rejects.toMatchObject({
      code: 'UPLOAD_METADATA_MISMATCH',
    });

    expect(tx.upload.create).not.toHaveBeenCalled();
    expect(tx.pendingUpload.update).not.toHaveBeenCalled();
  });

  test('does not finalize when the storage allowance is exceeded', async () => {
    tx.upload.aggregate.mockResolvedValue({
      _sum: { size: 1024 ** 3 },
    });

    await expect(finalize()).rejects.toMatchObject({
      code: 'STORAGE_ALLOWANCE_EXCEEDED',
      status: 413,
    });

    expect(tx.upload.create).not.toHaveBeenCalled();
    expect(tx.pendingUpload.update).not.toHaveBeenCalled();
  });
});
