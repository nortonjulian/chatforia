// server/stores/__tests__/verificationStore.test.js
import { jest, describe, test, expect } from '@jest/globals';
import * as crypto from 'crypto'; // used only for local sha256 helper

const ORIGINAL_ENV = process.env;

let prismaMock;

// Small helper to compute sha256 hex like the module under test
const sha256Hex = (s) =>
  crypto.createHash('sha256').update(s, 'utf8').digest('hex');

async function mockPrisma() {
  prismaMock = {
    verificationToken: {
      deleteMany: jest.fn(),
      create: jest.fn(),
      findFirst: jest.fn(),
      update: jest.fn(),
    },
  };

  // IMPORTANT: specifier must be resolvable from server/__tests__/jest.setup.js
  // ../utils/prismaClient.js -> server/utils/prismaClient.js
  await jest.unstable_mockModule('../utils/prismaClient.js', () => ({
    __esModule: true,
    default: prismaMock,
  }));
}

const reloadModule = async () => {
  jest.resetModules();
  process.env = { ...ORIGINAL_ENV };

  await mockPrisma();

  // now import the module under test
  return import('../verificationStore.js');
};

afterAll(() => {
  process.env = ORIGINAL_ENV;
});

beforeEach(() => {
  jest.clearAllMocks();
});

describe('verificationStore', () => {
  test('createVerificationToken deletes prior unused and creates new token with correct hash/expiry', async () => {
    const { createVerificationToken, MINUTES } = await reloadModule();

    const userId = 123;
    const type = 'email';
    const ttlMinutes = MINUTES(15); // pass-through

    prismaMock.verificationToken.create.mockResolvedValueOnce({ id: 1 });

    const before = Date.now();
    const res = await createVerificationToken(userId, type, ttlMinutes);
    const after = Date.now();

    // token should be a 64-char hex string (32 bytes)
    expect(typeof res.token).toBe('string');
    expect(res.token).toHaveLength(64);
    expect(res.expiresAt instanceof Date).toBe(true);

    // expiresAt should be in the future (relative to the call)
    const expiresMs = res.expiresAt.getTime();
    expect(expiresMs).toBeGreaterThan(after);

    // prior tokens deleted
    expect(prismaMock.verificationToken.deleteMany).toHaveBeenCalledWith({
      where: { userId, type, usedAt: null },
    });

    // hash in DB equals sha256(token)
    const expectedHash = sha256Hex(res.token);
    expect(prismaMock.verificationToken.create).toHaveBeenCalledWith({
      data: {
        userId,
        type,
        tokenHash: expectedHash,
        expiresAt: res.expiresAt,
      },
    });
  });

  test('consumeVerificationToken → invalid when no record found', async () => {
    const { consumeVerificationToken } = await reloadModule();

    prismaMock.verificationToken.findFirst.mockResolvedValueOnce(null);

    const out = await consumeVerificationToken(5, 'email', 'abc');
    expect(out).toEqual({ ok: false, reason: 'invalid' });
    expect(prismaMock.verificationToken.update).not.toHaveBeenCalled();
  });

  test('consumeVerificationToken → used when record.usedAt is set', async () => {
    const { consumeVerificationToken } = await reloadModule();

    const rec = {
      id: 10,
      userId: 5,
      type: 'email',
      tokenHash: sha256Hex('abc'),
      usedAt: new Date(Date.now() - 1000),
      expiresAt: new Date(Date.now() + 1000),
    };
    prismaMock.verificationToken.findFirst.mockResolvedValueOnce(rec);

    const out = await consumeVerificationToken(5, 'email', 'abc');
    expect(out).toEqual({ ok: false, reason: 'used' });
    expect(prismaMock.verificationToken.update).not.toHaveBeenCalled();
  });

  test('consumeVerificationToken → expired when rec.expiresAt < now', async () => {
    const { consumeVerificationToken } = await reloadModule();

    const rec = {
      id: 11,
      userId: 5,
      type: 'email',
      tokenHash: sha256Hex('abc'),
      usedAt: null,
      expiresAt: new Date(0), // way in the past
    };
    prismaMock.verificationToken.findFirst.mockResolvedValueOnce(rec);

    const out = await consumeVerificationToken(5, 'email', 'abc');
    expect(out).toEqual({ ok: false, reason: 'expired' });
    expect(prismaMock.verificationToken.update).not.toHaveBeenCalled();
  });

  test('consumeVerificationToken → success: updates usedAt and returns ok:true', async () => {
    const { consumeVerificationToken } = await reloadModule();

    const tokenPlain = 'mytoken';
    const rec = {
      id: 12,
      userId: 99,
      type: 'email',
      tokenHash: sha256Hex(tokenPlain),
      usedAt: null,
      // put expiry 60s in the future relative to now
      expiresAt: new Date(Date.now() + 60_000),
    };
    prismaMock.verificationToken.findFirst.mockResolvedValueOnce(rec);
    prismaMock.verificationToken.update.mockResolvedValueOnce({});

    const out = await consumeVerificationToken(99, 'email', tokenPlain);
    expect(out).toEqual({ ok: true });

    expect(prismaMock.verificationToken.update).toHaveBeenCalledWith({
      where: { id: 12 },
      data: { usedAt: expect.any(Date) },
    });
  });
});
