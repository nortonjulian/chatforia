import { jest } from '@jest/globals';

const db = {
  staffAssignment: {
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

const { lookupStaffAssignment } =
  await import('../staffAssignmentLookup.js');

const validAssignment = {
  profile: 'CTO',
  active: true,
  revokedAt: null,
  revokedById: null,
  user: {
    isBanned: false,
    deletedAt: null,
  },
};

beforeEach(() => {
  jest.clearAllMocks();
});

describe('server-authoritative staff assignment lookup', () => {
  test('rejects invalid account identifiers', async () => {
    for (const id of [undefined, null, 0, -1, '66', 1.5]) {
      expect(await lookupStaffAssignment(id, db)).toBeNull();
    }

    expect(db.staffAssignment.findUnique).not.toHaveBeenCalled();
  });

  test('returns null when assignment does not exist', async () => {
    db.staffAssignment.findUnique.mockResolvedValue(null);

    expect(await lookupStaffAssignment(66, db)).toBeNull();
  });

  test('rejects inactive assignments', async () => {
    db.staffAssignment.findUnique.mockResolvedValue({
      ...validAssignment,
      active: false,
    });

    expect(await lookupStaffAssignment(66, db)).toBeNull();
  });

  test('rejects revoked assignments', async () => {
    for (const changes of [
      { revokedAt: new Date() },
      { revokedById: 7 },
      { active: false, revokedAt: new Date(), revokedById: 7 },
    ]) {
      db.staffAssignment.findUnique.mockResolvedValue({
        ...validAssignment,
        ...changes,
      });

      expect(await lookupStaffAssignment(66, db)).toBeNull();
    }
  });

  test('rejects unknown staff profiles', async () => {
    db.staffAssignment.findUnique.mockResolvedValue({
      ...validAssignment,
      profile: 'FOUNDER',
    });

    expect(await lookupStaffAssignment(66, db)).toBeNull();
  });

  test('rejects banned or deleted accounts', async () => {
    for (const user of [
      { isBanned: true, deletedAt: null },
      { isBanned: false, deletedAt: new Date() },
      null,
    ]) {
      db.staffAssignment.findUnique.mockResolvedValue({
        ...validAssignment,
        user,
      });

      expect(await lookupStaffAssignment(66, db)).toBeNull();
    }
  });

  test('propagates database failures', async () => {
    db.staffAssignment.findUnique.mockRejectedValue(
      new Error('Database unavailable')
    );

    await expect(
      lookupStaffAssignment(66, db)
    ).rejects.toThrow('Database unavailable');
  });

  test('returns only authorized assignment information', async () => {
    db.staffAssignment.findUnique.mockResolvedValue(validAssignment);

    await expect(
      lookupStaffAssignment(66, db)
    ).resolves.toEqual({
      profile: 'CTO',
      active: true,
    });

    expect(db.staffAssignment.findUnique).toHaveBeenCalledWith({
      where: { userId: 66 },
      select: {
        profile: true,
        active: true,
        revokedAt: true,
        revokedById: true,
        user: {
          select: {
            isBanned: true,
            deletedAt: true,
          },
        },
      },
    });
  });
});
