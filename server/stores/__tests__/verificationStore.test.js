const ORIGINAL_ENV = process.env;

let prismaMock;
let randomBytesMock;

const FIXED_NOW = 1_700_000_000_000; // arbitrary fixed timestamp

// Small helper to compute sha256 hex like the module under test
import crypto from 'crypto';
const sha256Hex = (s) =>
  crypto.createHash('sha256').update(s, 'utf8').digest('hex');

function mockPrisma() {
  prismaMock = {
    verificationToken: {
      deleteMany: jest.fn(),
      create: jest.fn(),
      findFirst: jest.fn(),
      update: jest.fn(),
    },
  };

  jest.doMock('../../utils/prismaClient.js', () => ({
    __esModule: true,
    default: prismaMock,
  }));
}

function mockCryptoRandomBytes(hexByte = 0x01) {
  // deterministic 32 bytes buffer
  randomBytesMock = jest.fn(() => Buffer.alloc(32, hexByte));
  jest.doMock('crypto', () => {
    const real = jest.requireActual('crypto');
    return {
      __esModule: true,
      ...real,
      randomBytes: randomBytesMock,
    };
  });
}

const reloadModule = async () => {
  jest.resetModules();
  jest.spyOn(Date, 'now').mockReturnValue(FIXED_NOW);
  process.env = { ...ORIGINAL_ENV };
  mockPrisma();
  mockCryptoRandomBytes(0x01); // token will be '01' * 32 in hex (length 64)
  return import('../verificationStore.js');
};

afterAll(() => {
  process.env = ORIGINAL_ENV;
  jest.restoreAllMocks();
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

    // capture args to .create call to inspect stored tokenHash/expiresAt
    prismaMock.verificationToken.create.mockResolvedValueOnce({ id: 1 });

    const res = await createVerificationToken(userId, type, ttlMinutes);

    // token comes from randomBytes (32x 0x01) -> hex string '01' repeated
    expect(randomBytesMock).toHaveBeenCalledWith(32);
    expect(typeof res.token).toBe('string');
    expect(res.token).toHaveLength(64); // 32 bytes -> 64 hex chars
    expect(res.expiresAt instanceof Date).toBe(true);

    // expiresAt should be now + 15 minutes
    const expectedMs = FIXED_NOW + 15 * 60 * 1000;
    expect(res.expiresAt.getTime()).toBe(expectedMs);

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
        expiresAt: new Date(expectedMs),
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
      usedAt: new Date(FIXED_NOW - 1000),
      expiresAt: new Date(FIXED_NOW + 1000),
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
      expiresAt: new Date(FIXED_NOW - 1), // already expired
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
      expiresAt: new Date(FIXED_NOW + 60_000),
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
