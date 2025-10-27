import { jest } from '@jest/globals';

// We'll mock crypto + prisma before importing the module under test.
// We'll also freeze time using jest.useFakeTimers() so expiresAt math is stable.

const ORIGINAL_ENV = { ...process.env };

let mockPrisma;
let mockHashDigestData;
let randomBytesHexQueue;

function setupCryptoMock() {
  // We want a deterministic sha256 and deterministic randomBytes.
  // - createHash('sha256').update(...).digest('hex') should return "HASH_<input>"
  // - randomBytes(32).toString('hex') should pull from a queue that we control per test

  randomBytesHexQueue = [];

  jest.unstable_mockModule('crypto', () => ({
    default: {
      createHash: (algo) => ({
        _data: '',
        update(str) {
          this._data += str;
          return this;
        },
        digest(fmt) {
          // emulate 'hex' output. We'll cheat and return a safe deterministic string.
          if (fmt === 'hex') {
            return (
              'HASH_' + this._data.replace(/[^a-zA-Z0-9]/g, '_')
            );
          }
          return 'UNSUPPORTED_FORMAT';
        },
      }),
      randomBytes: (len) => {
        // pop from our queue; fallback to predictable string if empty
        const next =
          randomBytesHexQueue.length > 0
            ? randomBytesHexQueue.shift()
            : 'RANDOM_DEFAULT';
        // return a Buffer whose .toString('hex') becomes next
        return Buffer.from(next, 'utf8');
      },
    },
    createHash: (algo) => ({
      _data: '',
      update(str) {
        this._data += str;
        return this;
      },
      digest(fmt) {
        if (fmt === 'hex') {
          return 'HASH_' + this._data.replace(/[^a-zA-Z0-9]/g, '_');
        }
        return 'UNSUPPORTED_FORMAT';
      },
    }),
    randomBytes: (len) => {
      const next =
        randomBytesHexQueue.length > 0
          ? randomBytesHexQueue.shift()
          : 'RANDOM_DEFAULT';
      return Buffer.from(next, 'utf8');
    },
  }));

  return {
    pushRandomHex(val) {
      randomBytesHexQueue.push(val);
    },
  };
}

function setupPrismaMock() {
  // We'll mock prisma.passwordResetToken.* calls used in tokenStore.js.
  const deleteMany = jest.fn(async () => ({ count: 0 }));
  const create = jest.fn(async () => ({}));
  const findFirst = jest.fn(async () => null);
  const update = jest.fn(async () => ({}));

  // For purgeTokens: tokenStore calls deleteMany twice and expects { count }
  const deleteManyExpired = jest.fn(async () => ({ count: 5 }));
  const deleteManyOldUsed = jest.fn(async () => ({ count: 2 }));

  // Route calls based on "where" shape
  const smartDeleteMany = jest.fn(async (args) => {
    if (args.where && args.where.expiresAt) {
      return deleteManyExpired(args);
    }
    if (
      args.where &&
      args.where.usedAt &&
      args.where.usedAt.not !== undefined
    ) {
      return deleteManyOldUsed(args);
    }
    return deleteMany(args);
  });

  mockPrisma = {
    passwordResetToken: {
      deleteMany: smartDeleteMany,
      create,
      findFirst,
      update,
    },
  };

  jest.unstable_mockModule('../../utils/prismaClient.js', () => ({
    default: mockPrisma,
  }));

  return {
    spies: {
      deleteMany,
      create,
      findFirst,
      update,
      smartDeleteMany,
      deleteManyExpired,
      deleteManyOldUsed,
    },
  };
}

// helper to import the module fresh with current mocks + env
async function loadModuleFresh({ ttlMinutes } = {}) {
  jest.resetModules();

  if (ttlMinutes !== undefined) {
    process.env.PASSWORD_RESET_TOKEN_TTL_MINUTES = String(ttlMinutes);
  } else {
    delete process.env.PASSWORD_RESET_TOKEN_TTL_MINUTES;
  }

  const mod = await import('../../utils/tokenStore.js');
  return mod;
}

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  jest.useRealTimers();
  jest.resetModules();
  jest.restoreAllMocks();
});

describe('tokenStore.js', () => {
  test('hashToken() hashes deterministically with sha256 mock', async () => {
    const cryptoCtl = setupCryptoMock();
    setupPrismaMock();

    const { hashToken } = await loadModuleFresh();

    const out = hashToken('abc123!');
    expect(out).toBe('HASH_abc123_'); // from our mocked digest
  });

  test('createResetToken() creates a token, cleans previous tokens, stores hash, and respects TTL env', async () => {
    // Freeze time so expiresAt math is stable.
    // We'll say "now" is Jan 1, 2030 00:00:00 UTC
    jest.useFakeTimers().setSystemTime(
      new Date('2030-01-01T00:00:00.000Z')
    );

    const cryptoCtl = setupCryptoMock();
    const { spies } = setupPrismaMock();

    // Force the randomBytes result so the plaintext token is predictable.
    cryptoCtl.pushRandomHex('SUPERSECRETHEX');

    // Set TTL to 45 minutes for this test
    const { createResetToken } = await loadModuleFresh({ ttlMinutes: 45 });

    const result = await createResetToken(42); // userId = 42

    // 1. returned shape
    expect(result).toHaveProperty('token', 'SUPERSECRETHEX');
    expect(result).toHaveProperty('expiresAt');
    expect(result.expiresAt.toISOString()).toBe(
      '2030-01-01T00:45:00.000Z'
    );

    // 2. cleanup of previous tokens
    expect(spies.smartDeleteMany).toHaveBeenCalledWith({
      where: { userId: 42, usedAt: null },
    });

    // 3. prisma.passwordResetToken.create called with hash, not plaintext
    expect(spies.create).toHaveBeenCalledTimes(1);
    const arg = spies.create.mock.calls[0][0];
    expect(arg.data.userId).toBe(42);
    expect(arg.data.tokenHash).toBe('HASH_SUPERSECRETHEX');
    expect(arg.data.expiresAt.toISOString()).toBe(
      '2030-01-01T00:45:00.000Z'
    );
  });

  test('consumeResetToken() returns {ok:false, reason:"invalid"} if no record', async () => {
    const cryptoCtl = setupCryptoMock();
    const { spies } = setupPrismaMock();

    const { consumeResetToken } = await loadModuleFresh();

    // prisma.passwordResetToken.findFirst default mock returns null
    const res = await consumeResetToken('whatever');
    expect(res).toEqual({ ok: false, reason: 'invalid' });

    // should have looked up HASH_whatever
    expect(spies.findFirst).toHaveBeenCalledWith({
      where: { tokenHash: 'HASH_whatever' },
      select: {
        id: true,
        userId: true,
        expiresAt: true,
        usedAt: true,
      },
    });
  });

  test('consumeResetToken() rejects used tokens', async () => {
    jest.useFakeTimers().setSystemTime(
      new Date('2030-01-01T01:00:00.000Z')
    );

    const cryptoCtl = setupCryptoMock();
    const { spies } = setupPrismaMock();

    // used token
    spies.findFirst.mockResolvedValueOnce({
      id: 111,
      userId: 77,
      expiresAt: new Date('2030-01-01T02:00:00.000Z'),
      usedAt: new Date('2030-01-01T00:30:00.000Z'),
    });

    const { consumeResetToken } = await loadModuleFresh();

    const res = await consumeResetToken('USEDTOKEN');
    expect(res).toEqual({ ok: false, reason: 'used' });

    expect(spies.update).not.toHaveBeenCalled();
  });

  test('consumeResetToken() rejects expired tokens', async () => {
    jest.useFakeTimers().setSystemTime(
      new Date('2030-01-01T03:00:00.000Z')
    );

    const cryptoCtl = setupCryptoMock();
    const { spies } = setupPrismaMock();

    // expired token
    spies.findFirst.mockResolvedValueOnce({
      id: 222,
      userId: 88,
      expiresAt: new Date('2030-01-01T02:59:00.000Z'),
      usedAt: null,
    });

    const { consumeResetToken } = await loadModuleFresh();

    const res = await consumeResetToken('EXPIREDTOKEN');
    expect(res).toEqual({ ok: false, reason: 'expired' });

    expect(spies.update).not.toHaveBeenCalled();
  });

  test('consumeResetToken() marks token used and returns {ok:true,userId}', async () => {
    jest.useFakeTimers().setSystemTime(
      new Date('2030-01-01T01:00:00.000Z')
    );

    const cryptoCtl = setupCryptoMock();
    const { spies } = setupPrismaMock();

    // valid token
    spies.findFirst.mockResolvedValueOnce({
      id: 333,
      userId: 99,
      expiresAt: new Date('2030-01-01T02:00:00.000Z'),
      usedAt: null,
    });

    const { consumeResetToken } = await loadModuleFresh();

    const res = await consumeResetToken('GOODTOKEN');
    expect(res).toEqual({ ok: true, userId: 99 });

    // should have marked usedAt
    expect(spies.update).toHaveBeenCalledWith({
      where: { id: 333 },
      data: { usedAt: expect.any(Date) },
    });
    const usedAtWritten = spies.update.mock.calls[0][0].data.usedAt;
    expect(usedAtWritten instanceof Date).toBe(true);
    expect(usedAtWritten.getTime()).toBeGreaterThanOrEqual(
      new Date('2030-01-01T01:00:00.000Z').getTime()
    );
  });

  test('purgeTokens() deletes expired and old used tokens with correct cutoffs, returns counts', async () => {
    jest.useFakeTimers().setSystemTime(
      new Date('2030-01-10T12:00:00.000Z')
    );

    const cryptoCtl = setupCryptoMock();
    const { spies } = setupPrismaMock();

    const { purgeTokens } = await loadModuleFresh();

    const out = await purgeTokens(7); // "older than 7 days"
    expect(out).toEqual({ expired: 5, oldUsed: 2 });

    const calls = spies.smartDeleteMany.mock.calls;

    const expiresCall = calls.find(
      ([arg]) => arg.where && arg.where.expiresAt
    );
    const usedCall = calls.find(
      ([arg]) =>
        arg.where &&
        arg.where.usedAt &&
        arg.where.usedAt.not !== undefined
    );

    // sanity shapes
    expect(
      expiresCall[0].where.expiresAt.lt instanceof Date
    ).toBe(true);

    expect(usedCall[0].where.usedAt.not).toBeNull();
    expect(
      usedCall[0].where.usedAt.lt instanceof Date
    ).toBe(true);

    // cutoff = now - 7 days = 2030-01-03T12:00:00Z
    const cutoffDate = usedCall[0].where.usedAt.lt;
    expect(cutoffDate.toISOString()).toBe(
      '2030-01-03T12:00:00.000Z'
    );
  });
});
