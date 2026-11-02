import { jest } from '@jest/globals';

const db = {
  founderOwnership: {
    findUnique: jest.fn(),
  },
};

await jest.unstable_mockModule(
  '../utils/prismaClient.js',
  () => ({
    __esModule: true,
    default: db,
  })
);

const { getProtectedFounderUserId } =
  await import('../founderIdentity.js');

const validOwnership = {
  id: 1,
  userId: 66,
  user: {
    id: 66,
    isBanned: false,
    deletedAt: null,
  },
};

beforeEach(() => {
  jest.clearAllMocks();
});

describe('protected founder identity lookup', () => {
  test('returns the verified founder account ID', async () => {
    db.founderOwnership.findUnique.mockResolvedValue(
      validOwnership
    );

    await expect(
      getProtectedFounderUserId(db)
    ).resolves.toBe(66);

    expect(db.founderOwnership.findUnique).toHaveBeenCalledWith({
      where: { id: 1 },
      select: {
        id: true,
        userId: true,
        user: {
          select: {
            id: true,
            isBanned: true,
            deletedAt: true,
          },
        },
      },
    });
  });

  test('rejects missing ownership initialization', async () => {
    db.founderOwnership.findUnique.mockResolvedValue(null);

    await expect(
      getProtectedFounderUserId(db)
    ).rejects.toThrow(/not initialized or valid/);
  });

  test('rejects invalid ownership IDs', async () => {
    for (const changes of [
      { id: 2 },
      { userId: 0 },
      { userId: -1 },
      { userId: '66' },
      { userId: 1.5 },
    ]) {
      db.founderOwnership.findUnique.mockResolvedValue({
        ...validOwnership,
        ...changes,
      });

      await expect(
        getProtectedFounderUserId(db)
      ).rejects.toThrow(/not initialized or valid/);
    }
  });

  test('rejects mismatched founder user relationships', async () => {
    db.founderOwnership.findUnique.mockResolvedValue({
      ...validOwnership,
      user: {
        ...validOwnership.user,
        id: 99,
      },
    });

    await expect(
      getProtectedFounderUserId(db)
    ).rejects.toThrow(/not initialized or valid/);
  });

  test('rejects banned founder accounts', async () => {
    db.founderOwnership.findUnique.mockResolvedValue({
      ...validOwnership,
      user: {
        ...validOwnership.user,
        isBanned: true,
      },
    });

    await expect(
      getProtectedFounderUserId(db)
    ).rejects.toThrow(/not initialized or valid/);
  });

  test('rejects deleted founder accounts', async () => {
    db.founderOwnership.findUnique.mockResolvedValue({
      ...validOwnership,
      user: {
        ...validOwnership.user,
        deletedAt: new Date(),
      },
    });

    await expect(
      getProtectedFounderUserId(db)
    ).rejects.toThrow(/not initialized or valid/);
  });

  test('rejects missing founder user relationships', async () => {
    db.founderOwnership.findUnique.mockResolvedValue({
      ...validOwnership,
      user: null,
    });

    await expect(
      getProtectedFounderUserId(db)
    ).rejects.toThrow(/not initialized or valid/);
  });

  test('propagates database failures', async () => {
    db.founderOwnership.findUnique.mockRejectedValue(
      new Error('Database unavailable')
    );

    await expect(
      getProtectedFounderUserId(db)
    ).rejects.toThrow('Database unavailable');
  });
});
