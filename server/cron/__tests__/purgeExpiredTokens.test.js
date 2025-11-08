const ORIGINAL_ENV = process.env;

const prismaMock = {
  passwordResetToken: {
    deleteMany: jest.fn(),
    create: jest.fn(),
    findFirst: jest.fn(),
    update: jest.fn(),
  },
};
jest.mock('../../utils/prismaClient.js', () => ({
  __esModule: true,
  default: prismaMock,
}));

// Control random token generation
const randomBytesMock = jest.fn();
const realCrypto = await import('node:crypto');
jest.unstable_mockModule('node:crypto', () => ({
  __esModule: true,
  default: { ...realCrypto },
  // Named import used in file
  randomBytes: (...args) => randomBytesMock(...args),
  createHash: realCrypto.createHash,
}));

const reload = async (env = {}) => {
  jest.resetModules();
  process.env = { ...ORIGINAL_ENV, ...env };
  Object.values(prismaMock.passwordResetToken).forEach((fn) => fn.mockReset());
  randomBytesMock.mockReset();
  return import('../purgeExpiredTokens.js');
};

afterAll(() => {
  process.env = ORIGINAL_ENV;
});

describe('purgeExpiredTokens helpers', () => {
  describe('issueResetToken()', () => {
    test('deletes previous unused, creates hashed token with TTL and returns plaintext', async () => {
      // Make randomBytes deterministic: 32 bytes all = 0x11
      const buf = Buffer.alloc(32, 0x11);
      randomBytesMock.mockReturnValue(buf);

      const TTL_MINUTES = 45;
      const mod = await reload({ PASSWORD_RESET_TOKEN_TTL_MINUTES: String(TTL_MINUTES) });

      prismaMock.passwordResetToken.create.mockResolvedValue({ id: 1 });

      const before = Date.now();
      const plaintext = await mod.issueResetToken(123);
      const after = Date.now();

      // Returned plaintext matches our mocked bytes
      expect(plaintext).toBe(buf.toString('hex'));

      // Prior unused tokens revoked
      expect(prismaMock.passwordResetToken.deleteMany).toHaveBeenCalledWith({
        where: { userId: 123, usedAt: null },
      });

      // Created with hash of plaintext and proper expiresAt
      const createArgs = prismaMock.passwordResetToken.create.mock.calls[0][0];
      expect(createArgs.data.userId).toBe(123);
      expect(createArgs.data.tokenHash).toHaveLength(64); // sha256 hex length

      // Verify tokenHash equals SHA-256(plaintext)
      const expectedHash = realCrypto.createHash('sha256').update(plaintext, 'utf8').digest('hex');
      expect(createArgs.data.tokenHash).toBe(expectedHash);

      // TTL window check: expiresAt is ~45 minutes from now
      const expiresAtMs = +createArgs.data.expiresAt;
      expect(expiresAtMs).toBeGreaterThanOrEqual(before + TTL_MINUTES * 60 * 1000 - 50);
      expect(expiresAtMs).toBeLessThanOrEqual(after + TTL_MINUTES * 60 * 1000 + 50);
    });
  });

  describe('consumeResetToken()', () => {
    test('returns userId on valid, unused, unexpired token and marks used', async () => {
      const mod = await reload();

      // Prepare a stored record that matches hash("oktok")
      const hash = realCrypto.createHash('sha256').update('oktok', 'utf8').digest('hex');
      prismaMock.passwordResetToken.findFirst.mockResolvedValue({
        id: 10,
        userId: 777,
        expiresAt: new Date(Date.now() + 60_000),
        usedAt: null,
      });

      const out = await mod.consumeResetToken('oktok');

      // It searched by tokenHash
      expect(prismaMock.passwordResetToken.findFirst).toHaveBeenCalledWith({
        where: { tokenHash: hash },
        select: { id: true, userId: true, expiresAt: true, usedAt: true },
      });

      // Marked as used
      expect(prismaMock.passwordResetToken.update).toHaveBeenCalledWith({
        where: { id: 10 },
        data: { usedAt: expect.any(Date) },
      });

      expect(out).toBe(777);
    });

    test('returns null when not found', async () => {
      const mod = await reload();
      prismaMock.passwordResetToken.findFirst.mockResolvedValue(null);

      const out = await mod.consumeResetToken('nope');
      expect(out).toBeNull();
      expect(prismaMock.passwordResetToken.update).not.toHaveBeenCalled();
    });

    test('returns null when already used', async () => {
      const mod = await reload();
      prismaMock.passwordResetToken.findFirst.mockResolvedValue({
        id: 1,
        userId: 2,
        expiresAt: new Date(Date.now() + 60_000),
        usedAt: new Date(),
      });

      const out = await mod.consumeResetToken('already');
      expect(out).toBeNull();
      expect(prismaMock.passwordResetToken.update).not.toHaveBeenCalled();
    });

    test('returns null when expired', async () => {
      const mod = await reload();
      prismaMock.passwordResetToken.findFirst.mockResolvedValue({
        id: 1,
        userId: 2,
        expiresAt: new Date(Date.now() - 1), // past
        usedAt: null,
      });

      const out = await mod.consumeResetToken('expired');
      expect(out).toBeNull();
      expect(prismaMock.passwordResetToken.update).not.toHaveBeenCalled();
    });
  });

  describe('purgeResetTokens()', () => {
    test('deletes expired and old used tokens with expected filters', async () => {
      const mod = await reload();

      prismaMock.passwordResetToken.deleteMany.mockResolvedValue({ count: 0 });

      const before = Date.now();
      await mod.purgeResetTokens(3); // 3 days
      const after = Date.now();

      // First delete: expiresAt < now
      const call1 = prismaMock.passwordResetToken.deleteMany.mock.calls[0][0];
      expect(call1).toEqual({ where: { expiresAt: { lt: expect.any(Date) } } });
      const nowArg = call1.where.expiresAt.lt.valueOf();
      expect(nowArg).toBeGreaterThanOrEqual(before - 50);
      expect(nowArg).toBeLessThanOrEqual(after + 50);

      // Second delete: usedAt < cutoff (note: current code overwrites the "not: null")
      const call2 = prismaMock.passwordResetToken.deleteMany.mock.calls[1][0];
      expect(call2).toEqual({ where: { usedAt: { lt: expect.any(Date) } } });

      const cutoffArg = call2.where.usedAt.lt.valueOf();
      const expectedCutoffMin = before - 3 * 24 * 60 * 60 * 1000 - 50;
      const expectedCutoffMax = after - 3 * 24 * 60 * 60 * 1000 + 50;
      expect(cutoffArg).toBeGreaterThanOrEqual(expectedCutoffMin);
      expect(cutoffArg).toBeLessThanOrEqual(expectedCutoffMax);
    });
  });
});
