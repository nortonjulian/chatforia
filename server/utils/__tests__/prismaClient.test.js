/**
 * @file server/utils/__tests__/prismaClient.test.js
 *
 * NOTE: This suite is testing tokenStore.js (reset token lifecycle).
 * We mock prismaClient.js so tokenStore never talks to a real DB.
 */

import { jest } from '@jest/globals';
import crypto from 'crypto';

process.env.__SKIP_DB_WIPE__ = '1';

const ORIGINAL_ENV = { ...process.env };

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  jest.resetModules();
  jest.restoreAllMocks();
});

/**
 * Build in-memory fake prisma.passwordResetToken, mock prismaClient.js to return
 * that fake, then dynamically import tokenStore.js (so it uses the mock).
 */
async function loadTokenStoreWithMockPrisma({ now = Date.now() } = {}) {
  // pretend in-memory table
  const rows = [];

  const deleteMany = jest.fn(async ({ where }) => {
    const before = rows.length;

    function matchesWhere(row) {
      // (1) cleanup for user: { userId, usedAt: null }
      if (
        Object.prototype.hasOwnProperty.call(where, 'userId') &&
        Object.prototype.hasOwnProperty.call(where, 'usedAt') &&
        where.usedAt === null
      ) {
        if (row.userId !== where.userId) return false;
        if (row.usedAt !== null) return false;
        return true;
      }

      // (2) expired purge: { expiresAt: { lt: Date } }
      if (where.expiresAt?.lt instanceof Date) {
        return row.expiresAt < where.expiresAt.lt;
      }

      // (3) old used purge:
      // { usedAt: { not: null, lt: Date } }
      if (
        where.usedAt &&
        Object.prototype.hasOwnProperty.call(where.usedAt, 'not') &&
        where.usedAt.not !== null &&
        where.usedAt.lt instanceof Date
      ) {
        if (row.usedAt === null) return false;
        if (!(row.usedAt instanceof Date)) return false;
        return row.usedAt < where.usedAt.lt;
      }

      return false;
    }

    for (let i = rows.length - 1; i >= 0; i--) {
      if (matchesWhere(rows[i])) {
        rows.splice(i, 1);
      }
    }

    return { count: before - rows.length };
  });

  const create = jest.fn(async ({ data }) => {
    // tokenStore.createResetToken() writes { userId, tokenHash, expiresAt }
    const newRow = {
      id: crypto.randomUUID(),
      userId: data.userId,
      tokenHash: data.tokenHash,
      expiresAt: data.expiresAt,
      usedAt: data.usedAt ?? null,
      createdAt: new Date(now),
    };
    rows.push(newRow);
    return newRow;
  });

  const findFirst = jest.fn(async ({ where }) => {
    // tokenStore.consumeResetToken() calls with { where: { tokenHash } }
    const hit = rows.find((r) => r.tokenHash === where.tokenHash);
    if (!hit) return null;
    return {
      id: hit.id,
      userId: hit.userId,
      expiresAt: hit.expiresAt,
      usedAt: hit.usedAt,
    };
  });

  const update = jest.fn(async ({ where, data }) => {
    const idx = rows.findIndex((r) => r.id === where.id);
    if (idx === -1) throw new Error('not found');
    rows[idx] = { ...rows[idx], ...data };
    return rows[idx];
  });

  const mockPrisma = {
    passwordResetToken: {
      deleteMany,
      create,
      findFirst,
      update,
    },
  };

  // tokenStore.js imports prisma using:
  //   import prisma from '../utils/prismaClient.js';
  // tokenStore.js is utils/tokenStore.js
  // This file is utils/__tests__/prismaClient.test.js
  // In both cases '../utils/prismaClient.js' resolves to utils/prismaClient.js.
  jest.unstable_mockModule('../utils/prismaClient.js', () => ({
    default: mockPrisma,
    prisma: mockPrisma,
  }));

  // Import AFTER mocking so tokenStore sees mockPrisma.
  const tokenStore = await import('../tokenStore.js');

  return {
    tokenStore,
    rows,
    spies: { deleteMany, create, findFirst, update },
    now,
  };
}

describe('tokenStore.js', () => {
  test('hashToken() uses sha256 hex digest', async () => {
    const { tokenStore } = await loadTokenStoreWithMockPrisma();

    const FAKE_DIGEST = 'FAKE_HASH_123';
    const spy = jest.spyOn(crypto, 'createHash').mockReturnValueOnce({
      update: jest.fn().mockReturnThis(),
      digest: jest.fn(() => FAKE_DIGEST),
    });

    const out = tokenStore.hashToken('abc123');
    expect(out).toBe(FAKE_DIGEST);
    expect(spy).toHaveBeenCalledWith('sha256');
  });

  test('createResetToken() deletes previous unused tokens for user, stores hash, respects TTL env', async () => {
    process.env.PASSWORD_RESET_TOKEN_TTL_MINUTES = '45';

    const NOW = new Date('2030-01-01T00:00:00.000Z').getTime();
    jest.spyOn(Date, 'now').mockReturnValue(NOW);

    const { tokenStore, spies, rows } =
      await loadTokenStoreWithMockPrisma({ now: NOW });

    // Return a predictable "random" buffer.
    const fixedBuf = Buffer.from('PLAINTEXTTOKEN', 'utf8');
    jest
      .spyOn(crypto, 'randomBytes')
      .mockReturnValueOnce(fixedBuf);

    const result = await tokenStore.createResetToken(42);

    // createResetToken does .toString('hex') on that buffer
    const expectedPlaintext = fixedBuf.toString('hex');
    expect(result.token).toBe(expectedPlaintext);

    // TTL 45 minutes from NOW
    expect(result.expiresAt.toISOString()).toBe(
      '2030-01-01T00:45:00.000Z'
    );

    // Should have wiped previous unused tokens for that user
    expect(spies.deleteMany).toHaveBeenCalledWith({
      where: { userId: 42, usedAt: null },
    });

    // Should have created one record
    expect(spies.create).toHaveBeenCalledTimes(1);
    expect(rows).toHaveLength(1);

    const inserted = rows[0];

    // The DB row should store the hash of the plaintext token
    const expectedHash = tokenStore.hashToken(expectedPlaintext);
    expect(inserted.tokenHash).toBe(expectedHash);

    expect(inserted.userId).toBe(42);
    expect(inserted.usedAt).toBeNull();
    expect(inserted.expiresAt.toISOString()).toBe(
      '2030-01-01T00:45:00.000Z'
    );
  });

  test('consumeResetToken() returns {ok:false, reason:"invalid"} if no matching row', async () => {
    const NOW = new Date('2030-01-01T01:00:00.000Z').getTime();
    jest.spyOn(Date, 'now').mockReturnValue(NOW);

    const { tokenStore, spies } = await loadTokenStoreWithMockPrisma({
      now: NOW,
    });

    const plaintext = 'whatever';

    // Force prisma.findFirst to simulate "not found"
    spies.findFirst.mockResolvedValueOnce(null);

    const res = await tokenStore.consumeResetToken(plaintext);
    expect(res).toEqual({ ok: false, reason: 'invalid' });
  });

  test('consumeResetToken() rejects if token already used', async () => {
    const NOW = new Date('2030-01-01T01:00:00.000Z').getTime();
    jest.spyOn(Date, 'now').mockReturnValue(NOW);

    const { tokenStore, spies } = await loadTokenStoreWithMockPrisma({
      now: NOW,
    });

    const plaintext = 'usedtoken';

    // Mock a row that is already used
    spies.findFirst.mockResolvedValueOnce({
      id: 'row1',
      userId: 99,
      expiresAt: new Date('2030-01-01T02:00:00.000Z'),
      usedAt: new Date('2030-01-01T00:30:00.000Z'),
    });

    const res = await tokenStore.consumeResetToken(plaintext);
    expect(res).toEqual({ ok: false, reason: 'used' });
    expect(spies.update).not.toHaveBeenCalled();
  });

  test('consumeResetToken() rejects if token expired', async () => {
    const NOW = new Date('2030-01-01T03:00:00.000Z').getTime();
    jest.spyOn(Date, 'now').mockReturnValue(NOW);

    const { tokenStore, spies } = await loadTokenStoreWithMockPrisma({
      now: NOW,
    });

    const plaintext = 'expiredtoken';

    // expiresAt in the past relative to NOW
    spies.findFirst.mockResolvedValueOnce({
      id: 'row2',
      userId: 55,
      expiresAt: new Date('2030-01-01T02:59:00.000Z'),
      usedAt: null,
    });

    const res = await tokenStore.consumeResetToken(plaintext);
    expect(res).toEqual({ ok: false, reason: 'expired' });
    expect(spies.update).not.toHaveBeenCalled();
  });

  test('consumeResetToken() marks token used and returns {ok:true,userId}', async () => {
    const NOW = new Date('2030-01-01T01:00:00.000Z').getTime();
    jest.spyOn(Date, 'now').mockReturnValue(NOW);

    const { tokenStore, spies } = await loadTokenStoreWithMockPrisma({
      now: NOW,
    });

    const plaintext = 'validtoken';

    // A valid, unused, unexpired token
    spies.findFirst.mockResolvedValueOnce({
      id: 'row3',
      userId: 777,
      expiresAt: new Date('2030-01-01T02:00:00.000Z'),
      usedAt: null,
    });

    // Simulate prisma marking used
    spies.update.mockResolvedValueOnce({
      id: 'row3',
      userId: 777,
      usedAt: new Date(NOW),
    });

    const res = await tokenStore.consumeResetToken(plaintext);

    // We can't rely on exact timestamp equality from new Date(), so just assert shape.
    expect(spies.update).toHaveBeenCalledWith({
      where: { id: 'row3' },
      data: { usedAt: expect.any(Date) },
    });

    expect(res).toEqual({ ok: true, userId: 777 });
  });

  test('purgeTokens() deletes expired and old used tokens with correct cutoffs, returns counts', async () => {
    const NOW = new Date('2030-01-10T12:00:00.000Z').getTime();
    jest.spyOn(Date, 'now').mockReturnValue(NOW);

    const { tokenStore, spies } = await loadTokenStoreWithMockPrisma({
      now: NOW,
    });

    // prisma would return counts of deleted rows
    spies.deleteMany
      .mockResolvedValueOnce({ count: 5 }) // expired
      .mockResolvedValueOnce({ count: 2 }); // old used

    const result = await tokenStore.purgeTokens(7);

    // First deleteMany: expired tokens (expiresAt < now)
    const firstCallArg = spies.deleteMany.mock.calls[0][0];
    expect(firstCallArg).toEqual({
      where: {
        expiresAt: { lt: expect.any(Date) },
      },
    });

    // cutoff = NOW - 7 days
    const cutoff = new Date(NOW - 7 * 24 * 60 * 60 * 1000);

    // Second deleteMany: tokens that WERE used, and are older than cutoff
    expect(spies.deleteMany).toHaveBeenNthCalledWith(2, {
      where: {
        usedAt: {
          not: null,
          lt: cutoff,
        },
      },
    });

    expect(result).toEqual({ expired: 5, oldUsed: 2 });
  });
});
