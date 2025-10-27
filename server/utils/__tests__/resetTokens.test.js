import { jest } from '@jest/globals';

// Make sure the global jest.setup.js skips touching the real DB (and importing prisma)
// for this entire file. This must run before anything else in this test file executes.
process.env.__SKIP_DB_WIPE__ = '1';

// We'll dynamically import ../../utils/resetTokens.js after mocking its deps.
// We'll mock crypto to make output deterministic.
// We'll mock prisma.passwordResetToken methods and capture their calls.
// We'll control time with jest.useFakeTimers().

let prismaMock;
let randomBytesQueue;
const ORIGINAL_ENV = { ...process.env };

function setupCryptoMock() {
  // We'll make crypto.randomBytes() pull fixed values from a queue so the
  // plaintext token returned by issueResetToken() is predictable.
  // We'll also mock createHash('sha256').update(...).digest('hex')
  // to return "HASH_<plaintext>".

  randomBytesQueue = [];

  const randomBytes = (_len) => {
    const next =
      randomBytesQueue.length > 0
        ? randomBytesQueue.shift()
        : 'RANDOM_DEFAULT';
    return Buffer.from(next, 'utf8'); // .toString('hex') will be deterministic
  };

  const createHash = (_algo) => {
    let data = '';
    return {
      update(str) {
        data += str;
        return this;
      },
      digest(fmt) {
        if (fmt === 'hex') {
          return 'HASH_' + data.replace(/[^a-zA-Z0-9]/g, '_');
        }
        return 'UNSUPPORTED_FORMAT';
      },
    };
  };

  // Use node:crypto here ONLY if resetTokens.js imports from 'node:crypto'.
  // If resetTokens.js imports from 'crypto', then mock 'crypto' instead.
  jest.unstable_mockModule('crypto', () => ({
    default: { randomBytes, createHash },
    randomBytes,
    createHash,
  }));

  return {
    pushRandom(value) {
      randomBytesQueue.push(value);
    },
  };
}

function setupPrismaMock() {
  const deleteMany = jest.fn(async () => ({ count: 0 }));
  const create = jest.fn(async () => ({}));
  const findFirst = jest.fn(async () => null);
  const update = jest.fn(async () => ({}));

  prismaMock = {
    passwordResetToken: {
      deleteMany,
      create,
      findFirst,
      update,
    },
  };

  // SUPER IMPORTANT:
  // Your app code (resetTokens.js) should now import prisma like:
  //   import prisma from '@utils/prismaClient.js';
  //
  // We must mock that same specifier here so resetTokens.js
  // sees our fake prisma instead of trying to load the real one.
  jest.unstable_mockModule('@utils/prismaClient.js', () => ({
    default: prismaMock,
  }));

  return {
    spies: {
      deleteMany,
      create,
      findFirst,
      update,
    },
  };
}

async function loadModuleFresh() {
  // blow away Jest's module cache before re-importing with fresh mocks
  jest.resetModules();

  // Reapply SKIP_DB_WIPE for the newly loaded module environment
  process.env.__SKIP_DB_WIPE__ = '1';

  // crypto + prisma mocks must be set up BEFORE this import
  const mod = await import('@utils/resetTokens.js');
  return mod;
}

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  process.env.__SKIP_DB_WIPE__ = '1'; // keep future tests safe in this file

  jest.useRealTimers();
  jest.resetModules();
  jest.restoreAllMocks();
});

describe('resetTokens utils', () => {
  test('issueResetToken() returns plaintext token, stores hash+expiry, and deletes previous unused tokens', async () => {
    // Freeze time
    jest.useFakeTimers().setSystemTime(new Date('2035-06-01T12:00:00.000Z'));

    const cryptoCtl = setupCryptoMock();
    const { spies } = setupPrismaMock();

    // Push deterministic "random" bytes that will become plaintext token.
    // plaintext token = randomBytes(32).toString('hex')
    // We'll enqueue "TOKEN1" -> Buffer("TOKEN1").toString('hex') = "544f4b454e31"
    cryptoCtl.pushRandom('TOKEN1');

    const { issueResetToken } = await loadModuleFresh();

    const token = await issueResetToken(42);

    // 1. plaintext token equals the deterministic hex
    expect(token).toBe('544f4b454e31');

    // 2. deleteMany called first to clean old unused tokens for that user
    expect(spies.deleteMany).toHaveBeenCalledWith({
      where: { userId: 42, usedAt: null },
    });

    // 3. create called with hashed token and 30min expiry
    expect(spies.create).toHaveBeenCalledTimes(1);
    const arg = spies.create.mock.calls[0][0];

    expect(arg.data.userId).toBe(42);

    // hashToken logic: "HASH_<plaintext>"
    expect(arg.data.tokenHash).toBe('HASH_544f4b454e31');

    // expiresAt should be now + 30 minutes (TTL_MINUTES = 30 default)
    expect(arg.data.expiresAt.toISOString()).toBe(
      '2035-06-01T12:30:00.000Z'
    );
  });

  test('consumeResetToken() returns null on bad input', async () => {
    setupCryptoMock();
    const { spies } = setupPrismaMock();

    const { consumeResetToken } = await loadModuleFresh();

    await expect(consumeResetToken('')).resolves.toBeNull();
    await expect(consumeResetToken(null)).resolves.toBeNull();
    await expect(consumeResetToken(undefined)).resolves.toBeNull();

    expect(spies.findFirst).not.toHaveBeenCalled();
  });

  test('consumeResetToken() returns null if no matching valid token', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2035-06-01T12:00:00.000Z'));

    setupCryptoMock();
    const { spies } = setupPrismaMock();

    // default spies.findFirst resolves to null
    const { consumeResetToken } = await loadModuleFresh();

    const out = await consumeResetToken('SOMEPLAINTEXT');

    // We expect null for invalid / no-hit
    expect(out).toBeNull();

    // Ensure prisma.findFirst looked for unused, unexpired token
    expect(spies.findFirst).toHaveBeenCalledWith({
      where: {
        tokenHash: 'HASH_SOMEPLAINTEXT',
        usedAt: null,
        expiresAt: { gt: new Date('2035-06-01T12:00:00.000Z') },
      },
      select: { id: true, userId: true },
    });
  });

  test('consumeResetToken() returns userId and marks usedAt when valid token exists', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2035-06-01T12:00:00.000Z'));

    setupCryptoMock();
    const { spies } = setupPrismaMock();

    // Simulate a valid token row from DB
    spies.findFirst.mockResolvedValueOnce({
      id: 999,
      userId: 123,
    });

    const { consumeResetToken } = await loadModuleFresh();

    const out = await consumeResetToken('VALIDTOKEN');
    expect(out).toBe(123);

    // It should have updated usedAt
    expect(spies.update).toHaveBeenCalledWith({
      where: { id: 999 },
      data: { usedAt: expect.any(Date) },
    });

    // usedAt should be "now"
    const usedAtVal = spies.update.mock.calls[0][0].data.usedAt;
    expect(usedAtVal.toISOString()).toBe('2035-06-01T12:00:00.000Z');
  });

  test('purgeResetTokens() default: expiredOnly true, no userId -> deletes expired tokens only', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2035-06-10T00:00:00.000Z'));

    setupCryptoMock();
    const { spies } = setupPrismaMock();

    const { purgeResetTokens } = await loadModuleFresh();

    await purgeResetTokens(); // defaults

    expect(spies.deleteMany).toHaveBeenCalledTimes(1);
    const arg = spies.deleteMany.mock.calls[0][0];

    // should match { where: { expiresAt: { lt: now } } }
    expect(arg.where).toHaveProperty('expiresAt');
    expect(arg.where.expiresAt.lt).toEqual(
      new Date('2035-06-10T00:00:00.000Z')
    );
    expect(arg.where.userId).toBeUndefined();
  });

  test('purgeResetTokens({ expiredOnly:false, userId }) deletes all tokens for that user', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2035-06-10T00:00:00.000Z'));

    setupCryptoMock();
    const { spies } = setupPrismaMock();

    const { purgeResetTokens } = await loadModuleFresh();

    await purgeResetTokens({ expiredOnly: false, userId: 55 });

    expect(spies.deleteMany).toHaveBeenCalledTimes(1);
    const arg = spies.deleteMany.mock.calls[0][0];

    // when expiredOnly=false, we should NOT include expiresAt filter
    // but we SHOULD include userId filter
    expect(arg.where.expiresAt).toBeUndefined();
    expect(arg.where.userId).toBe(55);
  });

  test('purgeResetTokens({ userId }) combines expired filter + user filter', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2035-06-10T00:00:00.000Z'));

    setupCryptoMock();
    const { spies } = setupPrismaMock();

    const { purgeResetTokens } = await loadModuleFresh();

    await purgeResetTokens({ userId: '99' }); // string is allowed

    const arg = spies.deleteMany.mock.calls[0][0];

    // both filters present
    expect(arg.where.userId).toBe(99); // coerced to Number in your code
    expect(arg.where.expiresAt.lt).toEqual(
      new Date('2035-06-10T00:00:00.000Z')
    );
  });
});
