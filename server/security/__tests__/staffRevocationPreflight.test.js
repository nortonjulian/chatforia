import { jest } from '@jest/globals';

import {
  authorizeStaffRevocation,
} from '../staffRevocationPreflight.js';

const actor = () => ({
  id: 10,
  role: 'USER',
  tokenVersion: 3,
  isBanned: false,
  deletedAt: null,
  isSystem: false,
  isTestAccount: false,
  twoFactorEnabled: true,
  twoFactorEnrolledAt: new Date(),
  totpSecretEnc: 'encrypted-secret',
});

const target = () => ({
  ...actor(),
  id: 20,
  tokenVersion: 1,
});

const actorAssignment = () => ({
  profile: 'CTO',
  active: true,
  revokedAt: null,
  revokedById: null,
});

const targetAssignment = () => ({
  profile: 'SENIOR_ENGINEER',
  active: true,
  revokedAt: null,
  revokedById: null,
});

function makeTransaction() {
  return {
    $queryRaw: jest.fn(async (strings, ...values) => {
      const sql = strings.join(' ');

      if (
        sql.includes('WITH acquired AS MATERIALIZED') &&
        sql.includes('pg_advisory_xact_lock') &&
        values[0] === 73421 &&
        values[1] === 1
      ) {
        return [{ status: 'locked' }];
      }

      if (sql.includes('FROM "User"')) {
        return [{ id: values[0] }];
      }

      throw new Error('Unexpected query');
    }),

    founderOwnership: {
      findUnique: jest.fn(async () => ({
        id: 1,
        userId: 66,
        user: {
          id: 66,
          isBanned: false,
          deletedAt: null,
        },
      })),
    },

    user: {
      findUnique: jest.fn(async ({ where }) =>
        where.id === 10 ? actor() : target()
      ),
    },

    staffAssignment: {
      findUnique: jest.fn(async ({ where }) =>
        where.userId === 10
          ? actorAssignment()
          : targetAssignment()
      ),
    },
  };
}

const request = (overrides = {}) => ({
  actorUserId: 10,
  targetUserId: 20,
  authentication: {
    mfaVerified: true,
    tokenVersion: 3,
  },
  ...overrides,
});

describe('transactional staff revocation authorization', () => {
  test('authorizes CTO revocation of Senior Engineer', async () => {
    const tx = makeTransaction();

    const result = await authorizeStaffRevocation(
      tx,
      request()
    );

    expect(result.actorAssignment.profile).toBe('CTO');
    expect(result.targetAssignment.profile).toBe('SENIOR_ENGINEER');
    expect(tx.$queryRaw).toHaveBeenCalledTimes(3);
  });

  test('rejects stale authenticated sessions', async () => {
    const tx = makeTransaction();

    await expect(
      authorizeStaffRevocation(tx, request({
        authentication: {
          mfaVerified: true,
          tokenVersion: 2,
        },
      }))
    ).rejects.toThrow(/no longer current/);
  });

  test('rejects unverified MFA sessions', async () => {
    const tx = makeTransaction();

    await expect(
      authorizeStaffRevocation(tx, request({
        authentication: {
          mfaVerified: false,
          tokenVersion: 3,
        },
      }))
    ).rejects.toThrow(/Verified staff session required/);

    expect(tx.$queryRaw).not.toHaveBeenCalled();
  });

  test('rejects revoked actor assignments', async () => {
    const tx = makeTransaction();

    tx.staffAssignment.findUnique.mockImplementation(
      async ({ where }) =>
        where.userId === 10
          ? {
              ...actorAssignment(),
              active: false,
              revokedAt: new Date(),
              revokedById: 7,
            }
          : targetAssignment()
    );

    await expect(
      authorizeStaffRevocation(tx, request())
    ).rejects.toThrow(/revocation authority denied/);
  });

  test('rejects revocation of CTO assignments', async () => {
    const tx = makeTransaction();

    tx.staffAssignment.findUnique.mockImplementation(
      async ({ where }) =>
        where.userId === 10
          ? actorAssignment()
          : {
              ...targetAssignment(),
              profile: 'CTO',
            }
    );

    await expect(
      authorizeStaffRevocation(tx, request())
    ).rejects.toThrow(/revocation authority denied/);
  });

  test('allows revocation when target MFA is disabled', async () => {
    const tx = makeTransaction();

    tx.user.findUnique.mockImplementation(
      async ({ where }) =>
        where.id === 10
          ? actor()
          : {
              ...target(),
              twoFactorEnabled: false,
              twoFactorEnrolledAt: null,
              totpSecretEnc: null,
            }
    );

    await expect(
      authorizeStaffRevocation(tx, request())
    ).resolves.toMatchObject({
      target: { id: 20 },
    });
  });

  test('allows revocation of banned target accounts', async () => {
    const tx = makeTransaction();

    tx.user.findUnique.mockImplementation(
      async ({ where }) =>
        where.id === 10
          ? actor()
          : {
              ...target(),
              isBanned: true,
            }
    );

    await expect(
      authorizeStaffRevocation(tx, request())
    ).resolves.toMatchObject({
      target: { id: 20 },
    });
  });

  test('rejects founder target accounts', async () => {
    const tx = makeTransaction();

    await expect(
      authorizeStaffRevocation(tx, request({
        targetUserId: 66,
      }))
    ).rejects.toThrow(/Founder account cannot participate/);
  });

  test('rejects global administrator targets', async () => {
    const tx = makeTransaction();

    tx.user.findUnique.mockImplementation(
      async ({ where }) =>
        where.id === 10
          ? actor()
          : {
              ...target(),
              role: 'ADMIN',
            }
    );

    await expect(
      authorizeStaffRevocation(tx, request())
    ).rejects.toThrow(/eligibility denied/);
  });

  test('rejects database locking failures', async () => {
    const tx = makeTransaction();

    tx.$queryRaw.mockRejectedValue(
      new Error('Database unavailable')
    );

    await expect(
      authorizeStaffRevocation(tx, request())
    ).rejects.toThrow('Database unavailable');
  });
});
