import { jest } from '@jest/globals';
import {
  authorizeStaffGrantChange,
} from '../staffManagementPreflight.js';

const actor = () => ({
  id: 10,
  role: 'USER',
  tokenVersion: 3,
  isBanned: false,
  deletedAt: null,
  isSystem: false,
  isTestAccount: false,
  emailVerifiedAt: new Date(),
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

      throw new Error('Unexpected database query');
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
        where.userId === 10 ? actorAssignment() : null
      ),
    },
  };
}

const request = (overrides = {}) => ({
  actorUserId: 10,
  targetUserId: 20,
  targetProfile: 'SENIOR_ENGINEER',
  authentication: {
    mfaVerified: true,
    tokenVersion: 3,
  },
  ...overrides,
});

describe('transactional staff grant/change authorization', () => {
  test('authorizes an eligible CTO grant', async () => {
    const tx = makeTransaction();

    const result = await authorizeStaffGrantChange(
      tx,
      request()
    );

    expect(result.actor.id).toBe(10);
    expect(result.target.id).toBe(20);
    expect(result.actorAssignment.profile).toBe('CTO');
    expect(tx.$queryRaw).toHaveBeenCalledTimes(3);
  });

  test('rejects unverified or invalid session context', async () => {
    for (const authentication of [
      null,
      { mfaVerified: false, tokenVersion: 3 },
      { mfaVerified: true, tokenVersion: '3' },
      { mfaVerified: true, tokenVersion: -1 },
    ]) {
      const tx = makeTransaction();

      await expect(
        authorizeStaffGrantChange(
          tx,
          request({ authentication })
        )
      ).rejects.toThrow(/Verified staff session required/);

      expect(tx.$queryRaw).not.toHaveBeenCalled();
    }
  });

  test('rejects stale authenticated sessions', async () => {
    const tx = makeTransaction();

    await expect(
      authorizeStaffGrantChange(tx, request({
        authentication: {
          mfaVerified: true,
          tokenVersion: 2,
        },
      }))
    ).rejects.toThrow(/no longer current/);
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
          : null
    );

    await expect(
      authorizeStaffGrantChange(tx, request())
    ).rejects.toThrow(/delegation authority denied/);
  });

  test('rejects ineligible target accounts', async () => {
    const tx = makeTransaction();

    tx.user.findUnique.mockImplementation(async ({ where }) =>
      where.id === 10
        ? actor()
        : { ...target(), role: 'ADMIN' }
    );

    await expect(
      authorizeStaffGrantChange(tx, request())
    ).rejects.toThrow(/eligibility denied/);
  });

  test('rejects founder target accounts', async () => {
    const tx = makeTransaction();

    await expect(
      authorizeStaffGrantChange(tx, request({
        targetUserId: 66,
      }))
    ).rejects.toThrow(/Founder account cannot participate/);
  });

  test('rejects unauthorized changes to CTO assignments', async () => {
    const tx = makeTransaction();

    tx.staffAssignment.findUnique.mockImplementation(
      async ({ where }) =>
        where.userId === 10
          ? actorAssignment()
          : {
              profile: 'CTO',
              active: true,
              revokedAt: null,
              revokedById: null,
            }
    );

    await expect(
      authorizeStaffGrantChange(tx, request())
    ).rejects.toThrow(/delegation authority denied/);
  });

  test('rejects database locking failures', async () => {
    const tx = makeTransaction();

    tx.$queryRaw.mockRejectedValue(
      new Error('Database unavailable')
    );

    await expect(
      authorizeStaffGrantChange(tx, request())
    ).rejects.toThrow('Database unavailable');
  });
});
