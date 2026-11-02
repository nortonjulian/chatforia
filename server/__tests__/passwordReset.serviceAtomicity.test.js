import { jest, describe, test, beforeEach, expect } from '@jest/globals';

// In-memory transaction simulation, not real PostgreSQL concurrency testing.
const state = {
  token: null,
  user: null,
  failPasswordUpdate: false,
};

const tokenDb = {
  findFirst: jest.fn(async ({ where }) => {
    if (!state.token || state.token.tokenHash !== where.tokenHash) return null;
    return { ...state.token };
  }),

  updateMany: jest.fn(async ({ where, data }) => {
    const token = state.token;
    if (!token || token.id !== where.id || token.usedAt !== null ||
        !(token.expiresAt > where.expiresAt.gt)) {
      return { count: 0 };
    }
    token.usedAt = data.usedAt;
    return { count: 1 };
  }),
};

const userDb = {
  findUnique: jest.fn(async () => state.user),
  update: jest.fn(async ({ where, data }) => {
    if (state.failPasswordUpdate) {
      throw new Error('simulated password write failure');
    }
    if (where.id !== state.user.id) throw new Error('user not found');

    state.user.passwordHash = data.passwordHash;
    state.user.tokenVersion += data.tokenVersion.increment;
    return { ...state.user };
  }),
};

const prisma = {
  passwordResetToken: tokenDb,
  user: userDb,
  $transaction: jest.fn(async callback => {
    const previousToken = state.token ? { ...state.token } : null;
    const previousUser = state.user ? { ...state.user } : null;

    try {
      return await callback({
        passwordResetToken: tokenDb,
        user: userDb,
      });
    } catch (error) {
      state.token = previousToken;
      state.user = previousUser;
      throw error;
    }
  }),
};

jest.unstable_mockModule('../utils/prismaClient.js', () => ({
  default: prisma,
  prisma,
}));

jest.unstable_mockModule('../utils/sendMail.js', () => ({
  sendMail: jest.fn(),
}));

jest.unstable_mockModule('../utils/emailTemplates.js', () => ({
  passwordResetEmailTemplate: jest.fn(() => ({
    subject: '',
    text: '',
    html: '',
  })),
}));

const { hashToken, consumeResetToken } =
  await import('../utils/tokenStore.js');

const { resetPasswordWithToken, requestPasswordReset } =
  await import('../services/auth/passwordReset.js');

const plainToken = 'test-reset-token-do-not-use-in-production';

beforeEach(() => {
  state.token = {
    id: 101,
    userId: 201,
    tokenHash: hashToken(plainToken),
    usedAt: null,
    expiresAt: new Date(Date.now() + 60_000),
  };

  state.user = {
    id: 201,
    passwordHash: 'previous',
    tokenVersion: 5,
  };

  state.failPasswordUpdate = false;
  jest.clearAllMocks();
});

describe('passwordReset service and tokenStore', () => {
  test('successful reset consumes token and invalidates sessions', async () => {
    await expect(
      resetPasswordWithToken(plainToken, 'new-password-123')
    ).resolves.toEqual({ ok: true });

    expect(state.token.usedAt).toBeInstanceOf(Date);
    expect(state.user.tokenVersion).toBe(6);
    expect(state.user.passwordHash).not.toBe('previous');
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);

    expect(tokenDb.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          usedAt: null,
          expiresAt: { gt: expect.any(Date) },
        }),
      })
    );
  });

  test('failed password update rolls back token consumption', async () => {
    state.failPasswordUpdate = true;

    await expect(
      resetPasswordWithToken(plainToken, 'new-password-123')
    ).rejects.toThrow('simulated password write failure');

    expect(state.token.usedAt).toBeNull();
    expect(state.user.tokenVersion).toBe(5);
    expect(state.user.passwordHash).toBe('previous');
  });

  test('used token cannot reset password twice', async () => {
    await resetPasswordWithToken(plainToken, 'first-password');

    const firstHash = state.user.passwordHash;

    await expect(
      resetPasswordWithToken(plainToken, 'second-password')
    ).rejects.toThrow('token already used');

    expect(state.user.tokenVersion).toBe(6);
    expect(state.user.passwordHash).toBe(firstHash);
  });

  test('expired token cannot be claimed', async () => {
    state.token.expiresAt = new Date(Date.now() - 1_000);

    await expect(
      consumeResetToken(plainToken, prisma)
    ).resolves.toEqual({
      ok: false,
      reason: 'expired',
    });

    expect(tokenDb.updateMany).not.toHaveBeenCalled();
  });

  test('only one competing token consumer succeeds', async () => {
    const [a, b] = await Promise.all([
      consumeResetToken(plainToken, prisma),
      consumeResetToken(plainToken, prisma),
    ]);

    expect([a.ok, b.ok].filter(Boolean)).toHaveLength(1);
    expect(state.token.usedAt).toBeInstanceOf(Date);
  });
});


describe('protected public recovery isolation', () => {
  test.each([
    { role: 'ADMIN' },
    { staffAssignment: { id: 1 } },
    { founderOwnership: { id: 1 } },
  ])('does not issue public reset tokens for protected identities', async protection => {
    state.user = { ...state.user, ...protection };
    await expect(requestPasswordReset('staff@example.test')).resolves.toEqual({ ok: true });
    expect(state.token.usedAt).toBeNull();
  });
  test('unknown identity has the same public response', async () => {
    state.user = null;
    await expect(requestPasswordReset('unknown@example.test')).resolves.toEqual({ ok: true });
  });
});
