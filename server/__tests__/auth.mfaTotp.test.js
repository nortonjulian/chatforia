import { jest, describe, it, expect, beforeEach } from '@jest/globals';
import express from 'express';
import request from 'supertest';

// -----------------------------------------------------------------------------
// Current MFA dependencies
// -----------------------------------------------------------------------------

const mockGenerateSecret = jest.fn();
const mockTotpVerify = jest.fn();
const mockToDataURL = jest.fn();

const mockSeal = jest.fn();
const mockOpen = jest.fn();

const mockLockMfaUser = jest.fn();
const mockRecoveryCodeHash = jest.fn();

const mockIssueSession = jest.fn();

const tx = {
  $queryRaw: jest.fn(),
  user: {
    findUnique: jest.fn(),
    update: jest.fn(),
  },
  verificationToken: {
    findFirst: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    updateMany: jest.fn(),
  },
  twoFactorRecoveryCode: {
    deleteMany: jest.fn(),
    createMany: jest.fn(),
  },
};

const mockPrisma = {
  $transaction: jest.fn(async (callback) => callback(tx)),
};

jest.unstable_mockModule('../utils/prismaClient.js', () => ({
  __esModule: true,
  default: mockPrisma,
}));

jest.unstable_mockModule('speakeasy', () => ({
  __esModule: true,
  default: {
    generateSecret: mockGenerateSecret,
    totp: {
      verify: mockTotpVerify,
    },
  },
}));

jest.unstable_mockModule('qrcode', () => ({
  __esModule: true,
  default: {
    toDataURL: mockToDataURL,
  },
}));

jest.unstable_mockModule('../utils/secretBox.js', () => ({
  __esModule: true,
  seal: mockSeal,
  open: mockOpen,
}));

jest.unstable_mockModule('../services/mfaLogin.js', () => ({
  __esModule: true,
  lockMfaUser: mockLockMfaUser,
  recoveryCodeHash: mockRecoveryCodeHash,
}));

jest.unstable_mockModule('../routes/auth.js', () => ({
  __esModule: true,
  issueSession: mockIssueSession,
}));

const { router: mfaRouter } = await import('../routes/auth/mfaTotp.js');

// -----------------------------------------------------------------------------
// App helper — production mounts this router at /auth/2fa
// -----------------------------------------------------------------------------

function createApp(user = { id: 1, username: 'alice', tokenVersion: 0 }) {
  const app = express();

  app.use(express.json());

  app.use((req, _res, next) => {
    req.user = user;
    next();
  });

  app.use('/auth/2fa', mfaRouter);

  return app;
}

beforeEach(() => {
  jest.clearAllMocks();

  mockPrisma.$transaction.mockImplementation(
    async (callback) => callback(tx)
  );

  mockIssueSession.mockReturnValue('session-token');

  mockSeal.mockImplementation((value) => `ENC(${value})`);
  mockOpen.mockImplementation((value) => {
    if (value === 'ENC(BASE32SECRET)') return 'BASE32SECRET';
    return value;
  });

  mockRecoveryCodeHash.mockImplementation(
    (value) => `HASH(${value})`
  );

  tx.verificationToken.updateMany.mockResolvedValue({ count: 1 });
  tx.verificationToken.create.mockResolvedValue({ id: 501 });
  tx.verificationToken.update.mockResolvedValue({ id: 501 });

  tx.twoFactorRecoveryCode.deleteMany.mockResolvedValue({ count: 0 });
  tx.twoFactorRecoveryCode.createMany.mockResolvedValue({ count: 10 });

  tx.user.update.mockResolvedValue({
    id: 1,
    username: 'alice',
    twoFactorEnabled: true,
    tokenVersion: 1,
  });
});

// -----------------------------------------------------------------------------
// POST /auth/2fa/setup
// -----------------------------------------------------------------------------

describe('POST /auth/2fa/setup', () => {
  it('creates a pending MFA secret and QR code', async () => {
    mockGenerateSecret.mockReturnValue({
      base32: 'BASE32SECRET',
      otpauth_url:
        'otpauth://totp/Chatforia%20(alice)?secret=BASE32SECRET',
    });

    mockToDataURL.mockResolvedValue(
      'data:image/png;base64,QRDATA'
    );

    mockLockMfaUser.mockResolvedValue({
      id: 1,
      username: 'alice',
      twoFactorEnabled: false,
      tokenVersion: 0,
    });

    const res = await request(createApp())
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

    expect(tx.verificationToken.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: 1,
        type: 'mfa_setup',
        tokenHash: 'ENC(BASE32SECRET)',
        expiresAt: expect.any(Date),
      }),
    });
  });

  it('returns 409 when MFA is already enabled', async () => {
    mockGenerateSecret.mockReturnValue({
      base32: 'BASE32SECRET',
      otpauth_url: 'otpauth://example',
    });

    mockToDataURL.mockResolvedValue('data:image/png;base64,QR');

    mockLockMfaUser.mockResolvedValue({
      id: 1,
      username: 'alice',
      twoFactorEnabled: true,
      tokenVersion: 0,
    });

    const res = await request(createApp())
      .post('/auth/2fa/setup')
      .send();

    expect(res.statusCode).toBe(409);
  });
});

// -----------------------------------------------------------------------------
// POST /auth/2fa/enable
// -----------------------------------------------------------------------------

describe('POST /auth/2fa/enable', () => {
  it('rejects malformed verification codes before the transaction', async () => {
    const res = await request(createApp())
      .post('/auth/2fa/enable')
      .send({
        tmpSecret: 'BASE32SECRET',
        code: '123',
      });

    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({
      ok: false,
      reason: 'bad_code',
    });

    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
  });

  it('enables MFA and issues a new verified session', async () => {
    const user = {
      id: 10,
      username: 'carol',
      tokenVersion: 0,
    };

    mockLockMfaUser.mockResolvedValue({
      id: 10,
      username: 'carol',
      twoFactorEnabled: false,
      tokenVersion: 0,
    });

    tx.verificationToken.findFirst.mockResolvedValue({
      id: 700,
      userId: 10,
      type: 'mfa_setup',
      tokenHash: 'ENC(BASE32SECRET)',
      usedAt: null,
    });

    mockTotpVerify.mockReturnValue(true);

    tx.user.update.mockResolvedValue({
      id: 10,
      username: 'carol',
      twoFactorEnabled: true,
      tokenVersion: 1,
    });

    mockIssueSession.mockReturnValue('mfa-session-token');

    const res = await request(createApp(user))
      .post('/auth/2fa/enable')
      .send({
        tmpSecret: 'BASE32SECRET',
        code: '654321',
      });

    expect(res.statusCode).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.token).toBe('mfa-session-token');

    expect(res.body.backupCodes).toHaveLength(10);

    expect(mockTotpVerify).toHaveBeenCalledWith({
      secret: 'BASE32SECRET',
      encoding: 'base32',
      token: '654321',
      window: 1,
    });

    expect(tx.user.update).toHaveBeenCalledWith({
      where: { id: 10 },
      data: expect.objectContaining({
        twoFactorEnabled: true,
        totpSecretEnc: 'ENC(BASE32SECRET)',
        twoFactorEnrolledAt: expect.any(Date),
        tokenVersion: { increment: 1 },
      }),
    });

    expect(tx.twoFactorRecoveryCode.createMany).toHaveBeenCalled();

    expect(mockIssueSession).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        id: 10,
        twoFactorEnabled: true,
      }),
      { mfaVerified: true }
    );
  });
});

// -----------------------------------------------------------------------------
// POST /auth/2fa/disable
// -----------------------------------------------------------------------------

describe('POST /auth/2fa/disable', () => {
  it('disables MFA after verifying the current TOTP code', async () => {
    const user = {
      id: 50,
      username: 'dave',
      tokenVersion: 3,
    };

    mockLockMfaUser.mockResolvedValue({
      id: 50,
      username: 'dave',
      twoFactorEnabled: true,
      totpSecretEnc: 'ENC(BASE32SECRET)',
      tokenVersion: 3,
    });

    mockTotpVerify.mockReturnValue(true);

    tx.user.update.mockResolvedValue({
      id: 50,
      username: 'dave',
      twoFactorEnabled: false,
      tokenVersion: 4,
    });

    mockIssueSession.mockReturnValue('post-disable-token');

    const res = await request(createApp(user))
      .post('/auth/2fa/disable')
      .send({
        code: '111222',
      });

    expect(res.statusCode).toBe(200);

    expect(res.body).toEqual({
      ok: true,
      token: 'post-disable-token',
    });

    expect(mockTotpVerify).toHaveBeenCalledWith({
      secret: 'BASE32SECRET',
      encoding: 'base32',
      token: '111222',
      window: 1,
    });

    expect(tx.user.update).toHaveBeenCalledWith({
      where: { id: 50 },
      data: {
        twoFactorEnabled: false,
        totpSecretEnc: null,
        twoFactorEnrolledAt: null,
        tokenVersion: { increment: 1 },
      },
    });

    expect(tx.twoFactorRecoveryCode.deleteMany).toHaveBeenCalledWith({
      where: { userId: 50 },
    });

    expect(mockIssueSession).toHaveBeenCalled();
  });
});
