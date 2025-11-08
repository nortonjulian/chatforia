const ORIGINAL_ENV = process.env;

const prismaMock = {
  user: {
    findUnique: jest.fn(),
    update: jest.fn(),
  },
};

const tokenStoreMock = {
  createResetToken: jest.fn(),
  consumeResetToken: jest.fn(),
};

const bcryptMock = {
  hash: jest.fn(),
};

// We’ll swap this per test (either null or { sendMail: fn })
let transporterImpl = null;

const reload = async (env = {}) => {
  jest.resetModules();
  process.env = { ...ORIGINAL_ENV, ...env };

  // Mock prisma client
  jest.doMock('../../../utils/prismaClient.js', () => ({
    __esModule: true,
    default: prismaMock,
  }));

  // Mock token store
  jest.doMock('../../../utils/tokenStore.js', () => ({
    __esModule: true,
    createResetToken: tokenStoreMock.createResetToken,
    consumeResetToken: tokenStoreMock.consumeResetToken,
  }));

  // Mock mailer transporter (named export)
  jest.doMock('../../mailer.js', () => ({
    __esModule: true,
    transporter: transporterImpl,
  }));

  // Mock bcrypt
  jest.doMock('bcrypt', () => ({
    __esModule: true,
    default: bcryptMock,
    hash: bcryptMock.hash,
  }));

  return import('../passwordReset.js');
};

afterAll(() => {
  process.env = ORIGINAL_ENV;
});

beforeEach(() => {
  jest.clearAllMocks();
  transporterImpl = null;
});

describe('requestPasswordReset', () => {
  test('rejects when email is missing/empty', async () => {
    const { requestPasswordReset } = await reload();

    await expect(requestPasswordReset('')).rejects.toMatchObject({
      isBoom: true,
      output: { statusCode: 400 },
    });
    await expect(requestPasswordReset(null)).rejects.toMatchObject({
      isBoom: true,
      output: { statusCode: 400 },
    });

    expect(prismaMock.user.findUnique).not.toHaveBeenCalled();
  });

  test('returns {ok:true} when user is not found (no enumeration)', async () => {
    prismaMock.user.findUnique.mockResolvedValueOnce(null);
    const { requestPasswordReset } = await reload();

    const res = await requestPasswordReset('NoUser@Example.com  ');
    expect(res).toEqual({ ok: true });

    // Email normalized to lowercase and trimmed
    expect(prismaMock.user.findUnique).toHaveBeenCalledWith({
      where: { email: 'nouser@example.com' },
      select: { id: true, username: true, email: true },
    });
  });

  test('returns {ok:true} when transporter is falsy (email disabled)', async () => {
    transporterImpl = null; // ensure disabled
    prismaMock.user.findUnique.mockResolvedValueOnce({
      id: 7,
      username: 'J',
      email: 'j@example.com',
    });

    const { requestPasswordReset } = await reload({
      APP_ORIGIN: 'https://app.example.com',
    });

    const res = await requestPasswordReset('j@example.com');
    expect(res).toEqual({ ok: true });
    expect(tokenStoreMock.createResetToken).not.toHaveBeenCalled();
  });

  test('happy path: creates token and sends mail with trimmed APP_ORIGIN', async () => {
    const sendMail = jest.fn().mockResolvedValue({});
    transporterImpl = { sendMail };
    prismaMock.user.findUnique.mockResolvedValueOnce({
      id: 42,
      username: 'Julian',
      email: 'julian@example.com',
    });
    const fakeToken = 'reset-token-abc';
    const fakeExp = new Date('2030-01-01T00:00:00.000Z');
    tokenStoreMock.createResetToken.mockResolvedValueOnce({
      token: fakeToken,
      expiresAt: fakeExp,
    });

    const { requestPasswordReset } = await reload({
      APP_ORIGIN: 'https://chatforia.app///', // should trim trailing slashes
      MAIL_FROM: 'noreply@chatforia.app',
    });

    const res = await requestPasswordReset('julian@example.com');
    expect(res).toEqual({ ok: true });

    // Created a reset token for the user id
    expect(tokenStoreMock.createResetToken).toHaveBeenCalledWith(42);

    // Verify mail fields; keep assertions focused and resilient
    expect(sendMail).toHaveBeenCalledTimes(1);
    const call = sendMail.mock.calls[0][0];

    expect(call.from).toBe('noreply@chatforia.app');
    expect(call.to).toBe('julian@example.com');
    expect(call.subject).toMatch(/Reset your Chatforia password/i);

    // Reset URL should be built from trimmed APP_ORIGIN
    const expectedUrl = `https://chatforia.app/reset-password?token=${encodeURIComponent(fakeToken)}`;
    expect(call.text).toContain(expectedUrl);
    expect(call.text).toContain(fakeExp.toISOString());
    expect(call.html).toContain(expectedUrl);
    expect(call.html).toContain(fakeExp.toISOString());
  });
});

describe('resetPasswordWithToken', () => {
  test('rejects when token missing', async () => {
    const { resetPasswordWithToken } = await reload();
    await expect(resetPasswordWithToken('', 'abcdefgh')).rejects.toMatchObject({
      isBoom: true,
      output: { statusCode: 400 },
    });
  });

  test('rejects when password too short (<8)', async () => {
    const { resetPasswordWithToken } = await reload();
    await expect(resetPasswordWithToken('t', 'short')).rejects.toMatchObject({
      isBoom: true,
      output: { statusCode: 400 },
    });
  });

  test('maps invalid/expired/used token reasons to 400 errors', async () => {
    const { resetPasswordWithToken } = await reload();

    tokenStoreMock.consumeResetToken.mockResolvedValueOnce({ ok: false, reason: 'invalid' });
    await expect(resetPasswordWithToken('tok1', 'abcdefgh')).rejects.toMatchObject({
      isBoom: true,
      output: { statusCode: 400 },
    });

    tokenStoreMock.consumeResetToken.mockResolvedValueOnce({ ok: false, reason: 'expired' });
    await expect(resetPasswordWithToken('tok2', 'abcdefgh')).rejects.toMatchObject({
      isBoom: true,
      output: { statusCode: 400 },
    });

    tokenStoreMock.consumeResetToken.mockResolvedValueOnce({ ok: false, reason: 'used' });
    await expect(resetPasswordWithToken('tok3', 'abcdefgh')).rejects.toMatchObject({
      isBoom: true,
      output: { statusCode: 400 },
    });
  });

  test('happy path: hashes with BCRYPT_ROUNDS and updates passwordHash', async () => {
    const rounds = 12;
    const { resetPasswordWithToken } = await reload({ BCRYPT_ROUNDS: String(rounds) });

    tokenStoreMock.consumeResetToken.mockResolvedValueOnce({ ok: true, userId: 99 });
    bcryptMock.hash.mockResolvedValueOnce('hashedpw');

    const res = await resetPasswordWithToken('good-token', 'NewPassword123');

    expect(bcryptMock.hash).toHaveBeenCalledWith('NewPassword123', rounds);
    expect(prismaMock.user.update).toHaveBeenCalledWith({
      where: { id: 99 },
      data: { passwordHash: 'hashedpw' },
    });
    expect(res).toEqual({ ok: true });
  });

  test('uses default rounds=10 when BCRYPT_ROUNDS unset', async () => {
    const { resetPasswordWithToken } = await reload({ BCRYPT_ROUNDS: '' });

    tokenStoreMock.consumeResetToken.mockResolvedValueOnce({ ok: true, userId: 5 });
    bcryptMock.hash.mockResolvedValueOnce('hpw');

    await resetPasswordWithToken('t', 'abcdefgh');

    expect(bcryptMock.hash).toHaveBeenCalledWith('abcdefgh', 10);
  });
});
