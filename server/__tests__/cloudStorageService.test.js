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
