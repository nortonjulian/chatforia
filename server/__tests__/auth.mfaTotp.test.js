import { jest, describe, it, expect, beforeEach } from '@jest/globals';
import express from 'express';
import request from 'supertest';
import crypto from 'crypto';

// --- Prisma mocks ------------------------------------------------------------

const mockUserFindUnique = jest.fn();
const mockUserUpdate = jest.fn();
const mockRecoveryDeleteMany = jest.fn();
const mockRecoveryCreateMany = jest.fn();
const mockTransaction = jest.fn((ops) => Promise.all(ops));

const mockPrisma = {
  user: {
    findUnique: mockUserFindUnique,
    update: mockUserUpdate,
  },
  twoFactorRecoveryCode: {
    deleteMany: mockRecoveryDeleteMany,
    createMany: mockRecoveryCreateMany,
  },
  $transaction: mockTransaction,
};

jest.unstable_mockModule('../utils/prismaClient.js', () => ({
  __esModule: true,
  default: mockPrisma,
}));

// --- speakeasy mock ----------------------------------------------------------

const mockGenerateSecret = jest.fn();
const mockTotpVerify = jest.fn();

jest.unstable_mockModule('speakeasy', () => ({
  __esModule: true,
  default: {
    generateSecret: mockGenerateSecret,
    totp: {
      verify: mockTotpVerify,
    },
  },
}));

// --- qrcode mock -------------------------------------------------------------

const mockToDataURL = jest.fn();

jest.unstable_mockModule('qrcode', () => ({
  __esModule: true,
  default: {
    toDataURL: mockToDataURL,
  },
}));

// --- secretBox mock ----------------------------------------------------------

const mockSeal = jest.fn();
const mockOpen = jest.fn();

jest.unstable_mockModule('../utils/secretBox.js', () => ({
  __esModule: true,
  seal: mockSeal,
  open: mockOpen,
}));

// Import router AFTER mocks
const mfaModule = await import('../routes/auth/mfaTotp.js');
const mfaRouter = mfaModule.router;

// --- Helper: app builder -----------------------------------------------------

function createApp({ user } = {}) {
  const app = express();
  app.use(express.json());

  // minimal "auth" injection so routes see req.user
  app.use((req, res, next) => {
    if (user) {
      req.user = user;
    } else {
      // default fake user
      req.user = { id: 123, username: 'alice' };
    }
    next();
  });

  app.use('/auth', mfaRouter);
  return app;
}

// local sha256 to verify recovery code hashes
function sha256(s) {
  return crypto.createHash('sha256').update(s, 'utf8').digest('hex');
}

beforeEach(() => {
  jest.clearAllMocks();

  mockUserFindUnique.mockReset();
  mockUserUpdate.mockReset();
  mockRecoveryDeleteMany.mockReset();
  mockRecoveryCreateMany.mockReset();
  mockTransaction.mockReset();
  mockGenerateSecret.mockReset();
  mockTotpVerify.mockReset();
  mockToDataURL.mockReset();
  mockSeal.mockReset();
  mockOpen.mockReset();
});

// --- Tests: POST /auth/2fa/setup ---------------------------------------------

describe('POST /auth/2fa/setup', () => {
  it('returns a tmpSecret and qrDataUrl using speakeasy + qrcode', async () => {
    const app = createApp({ user: { id: 1, username: 'alice' } });

    mockGenerateSecret.mockReturnValue({
      base32: 'BASE32SECRET',
      otpauth_url: 'otpauth://totp/Chatforia%20(alice)?secret=BASE32SECRET',
    });

    mockToDataURL.mockResolvedValueOnce('data:image/png;base64,QRDATA');

    const res = await request(app)
      .post('/auth/2fa/setup')
      .send();

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({
      ok: true,
      tmpSecret: 'BASE32SECRET',
      qrDataUrl: 'data:image/png;base64,QRDATA',
    });

    expect(mockGenerateSecret).toHaveBeenCalledWith({
      length: 20,
      name: 'Chatforia (alice)',
      issuer: 'Chatforia',
    });

    expect(mockToDataURL).toHaveBeenCalledWith(
      'otpauth://totp/Chatforia%20(alice)?secret=BASE32SECRET'
    );
  });
});

// --- Tests: POST /auth/2fa/enable --------------------------------------------

describe('POST /auth/2fa/enable', () => {
  it('returns 400 when TOTP code is invalid', async () => {
    const app = createApp({ user: { id: 5, username: 'bob' } });

    mockTotpVerify.mockReturnValueOnce(false);

    const res = await request(app)
      .post('/auth/2fa/enable')
      .send({ tmpSecret: 'INVALIDSECRET', code: '123456' });

    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({ ok: false, reason: 'bad_code' });

    expect(mockTotpVerify).toHaveBeenCalledWith({
      secret: 'INVALIDSECRET',
      encoding: 'base32',
      token: '123456',
      window: 1,
    });

    expect(mockTransaction).not.toHaveBeenCalled();
  });

  it('enables 2FA, creates backup codes, and stores hashed recovery codes', async () => {
    const user = { id: 10, username: 'carol' };
    const app = createApp({ user });

    mockTotpVerify.mockReturnValueOnce(true);

    // seal() returns a deterministic value
    mockSeal.mockImplementation((s) => `ENC(${s})`);

    // Let prisma.$transaction resolve successfully
    mockTransaction.mockResolvedValueOnce([]);

    const res = await request(app)
      .post('/auth/2fa/enable')
      .send({ tmpSecret: 'BASE32SECRET', code: '654321' });

    expect(res.statusCode).toBe(200);
    expect(res.body.ok).toBe(true);

    // backupCodes are random; just check shape and count
    const { backupCodes } = res.body;
    expect(Array.isArray(backupCodes)).toBe(true);
    expect(backupCodes).toHaveLength(10);
    for (const code of backupCodes) {
      // pattern XXXX-XXXX-XXXX, uppercase, alnum + _ or -
      expect(code).toMatch(/^[A-Z0-9_\-]{4}-[A-Z0-9_\-]{4}-[A-Z0-9_\-]{3,4}$/);
    }

    // prisma.$transaction called with three operations
    expect(mockTransaction).toHaveBeenCalledTimes(1);
    expect(mockUserUpdate).toHaveBeenCalledTimes(1);
    expect(mockRecoveryDeleteMany).toHaveBeenCalledTimes(1);
    expect(mockRecoveryCreateMany).toHaveBeenCalledTimes(1);

    // user.update data
    const userUpdateArgs = mockUserUpdate.mock.calls[0][0];
    expect(userUpdateArgs.where).toEqual({ id: user.id });
    expect(userUpdateArgs.data.twoFactorEnabled).toBe(true);
    expect(userUpdateArgs.data.totpSecretEnc).toBe('ENC(BASE32SECRET)');
    expect(userUpdateArgs.data.twoFactorEnrolledAt).toBeInstanceOf(Date);

    // recovery codes created with hashes
    const createManyArgs = mockRecoveryCreateMany.mock.calls[0][0];
    expect(Array.isArray(createManyArgs.data)).toBe(true);
    expect(createManyArgs.data).toHaveLength(10);
    for (let i = 0; i < createManyArgs.data.length; i++) {
      const row = createManyArgs.data[i];
      expect(row.userId).toBe(user.id);
      expect(typeof row.codeHash).toBe('string');
      expect(row.codeHash).toHaveLength(64);

      // ensure hash matches corresponding backupCode
      const expectedHash = sha256(backupCodes[i]);
      expect(row.codeHash).toBe(expectedHash);
    }
  });
});

// --- Tests: POST /auth/2fa/disable -------------------------------------------

describe('POST /auth/2fa/disable', () => {
  it('returns 400 if no TOTP secret is stored for user', async () => {
    const user = { id: 50, username: 'dave' };
    const app = createApp({ user });

    mockUserFindUnique.mockResolvedValueOnce({
      id: 50,
      totpSecretEnc: null,
      twoFactorEnabled: false,
    });

    const res = await request(app)
      .post('/auth/2fa/disable')
      .send({ code: '000000' });

    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({ ok: false });

    expect(mockUserFindUnique).toHaveBeenCalledWith({
      where: { id: user.id },
    });
    expect(mockTransaction).not.toHaveBeenCalled();
  });

  it('returns 400 bad_code when TOTP verification fails', async () => {
    const user = { id: 60, username: 'eve' };
    const app = createApp({ user });

    mockUserFindUnique.mockResolvedValueOnce({
      id: 60,
      totpSecretEnc: 'ENC(SECRET)',
    });

    mockOpen.mockReturnValue('BASE32SECRET');
    mockTotpVerify.mockReturnValueOnce(false);

    const res = await request(app)
      .post('/auth/2fa/disable')
      .send({ code: '111222' });

    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({ ok: false, reason: 'bad_code' });

    expect(mockOpen).toHaveBeenCalledWith('ENC(SECRET)');
    expect(mockTotpVerify).toHaveBeenCalledWith({
      secret: 'BASE32SECRET',
      encoding: 'base32',
      token: '111222',
      window: 1,
    });

    expect(mockTransaction).not.toHaveBeenCalled();
  });

  it('disables 2FA and clears recovery codes when code is valid', async () => {
    const user = { id: 70, username: 'frank' };
    const app = createApp({ user });

    mockUserFindUnique.mockResolvedValueOnce({
      id: 70,
      totpSecretEnc: 'ENC(SECRET)',
    });

    mockOpen.mockReturnValue('BASE32SECRET');
    mockTotpVerify.mockReturnValueOnce(true);
    mockTransaction.mockResolvedValueOnce([]);

    const res = await request(app)
      .post('/auth/2fa/disable')
      .send({ code: '999000' });

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ ok: true });

    expect(mockUserFindUnique).toHaveBeenCalledWith({
      where: { id: user.id },
    });

    expect(mockTransaction).toHaveBeenCalledTimes(1);
    expect(mockUserUpdate).toHaveBeenCalledTimes(1);
    expect(mockRecoveryDeleteMany).toHaveBeenCalledTimes(1);

    const userUpdateArgs = mockUserUpdate.mock.calls[0][0];
    expect(userUpdateArgs.where).toEqual({ id: user.id });
    expect(userUpdateArgs.data).toEqual({
      twoFactorEnabled: false,
      totpSecretEnc: null,
      twoFactorEnrolledAt: null,
    });

    const deleteArgs = mockRecoveryDeleteMany.mock.calls[0][0];
    expect(deleteArgs.where).toEqual({ userId: user.id });
  });
});
