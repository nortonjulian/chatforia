import { jest, describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import express from 'express';
import request from 'supertest';

process.env.NODE_ENV = 'test';
process.env.SMS_CONSENT_VERSION = 'v1';

// --- Prisma mocks ------------------------------------------------------------

const mockPhoneOtpCount = jest.fn();
const mockPhoneOtpCreate = jest.fn();
const mockPhoneOtpFindFirst = jest.fn();
const mockPhoneOtpUpdate = jest.fn();
const mockPhoneOtpUpdateMany = jest.fn();
const mockPhoneOtpDeleteMany = jest.fn();

const mockSmsConsentCreate = jest.fn();
const mockSmsConsentFindFirst = jest.fn();

const mockPrisma = {
  phoneOtp: {
    count: mockPhoneOtpCount,
    create: mockPhoneOtpCreate,
    findFirst: mockPhoneOtpFindFirst,
    update: mockPhoneOtpUpdate,
    updateMany: mockPhoneOtpUpdateMany,
    deleteMany: mockPhoneOtpDeleteMany,
  },

  smsConsent: {
    create: mockSmsConsentCreate,
    findFirst: mockSmsConsentFindFirst,
  },

  // Included so routes/auth.js can import safely even though these
  // are not used by the phone OTP tests below.
  user: {
    findUnique: jest.fn(),
    findFirst: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  },

  verificationToken: {
    findFirst: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    updateMany: jest.fn(),
  },

  twoFactorRecoveryCode: {
    findFirst: jest.fn(),
    update: jest.fn(),
  },

  subscriber: {
    findFirst: jest.fn(),
  },

  $transaction: jest.fn(),
};

jest.unstable_mockModule('../utils/prismaClient.js', () => ({
  __esModule: true,
  default: mockPrisma,
}));

// --- SMS mock ----------------------------------------------------------------

const mockSendSms = jest.fn();

jest.unstable_mockModule('../lib/telco/index.js', () => ({
  __esModule: true,
  sendSms: mockSendSms,
}));

// --- phone helper mock --------------------------------------------------------

const mockNormalizeE164 = jest.fn((phone) => String(phone).trim());

jest.unstable_mockModule('../utils/phone.js', () => ({
  __esModule: true,
  normalizeE164: mockNormalizeE164,
}));

// --- Rate limiter mock --------------------------------------------------------

jest.unstable_mockModule('express-rate-limit', () => ({
  __esModule: true,
  default: () => (_req, _res, next) => next(),
}));

// --- Other auth.js dependency mocks ------------------------------------------

jest.unstable_mockModule('../middleware/auth.js', () => ({
  __esModule: true,
  requireAuth: (req, _res, next) => {
    if (!req.user) req.user = { id: 123, role: 'USER', plan: 'FREE' };
    next();
  },
}));

jest.unstable_mockModule('../middleware/csrf.js', () => ({
  __esModule: true,
  setCsrfCookie: jest.fn(),
}));

jest.unstable_mockModule('../utils/sendMail.js', () => ({
  __esModule: true,
  sendMail: jest.fn(),
}));

jest.unstable_mockModule('../utils/encryption.js', () => ({
  __esModule: true,
  generateKeyPair: jest.fn(() => ({
    publicKey: 'mock-public-key',
    privateKey: 'mock-private-key',
  })),
}));

jest.unstable_mockModule('../utils/resetTokens.js', () => ({
  __esModule: true,
  issueResetToken: jest.fn(),
  consumeResetToken: jest.fn(),
}));

jest.unstable_mockModule('../utils/tokens.js', () => ({
  __esModule: true,
  newRawToken: jest.fn(() => 'raw-token'),
  hashToken: jest.fn(async (token) => `hashed-${token}`),
}));

jest.unstable_mockModule('../utils/secretBox.js', () => ({
  __esModule: true,
  open: jest.fn(() => 'mock-secret'),
}));

jest.unstable_mockModule('../utils/serializeUser.js', () => ({
  __esModule: true,
  serializeUser: jest.fn((user) => user),
}));

jest.unstable_mockModule('bcrypt', () => ({
  __esModule: true,
  default: {
    hash: jest.fn(async () => 'hashed-password'),
    compare: jest.fn(async () => true),
  },
}));

jest.unstable_mockModule('jsonwebtoken', () => ({
  __esModule: true,
  default: {
    sign: jest.fn(() => 'mock-jwt'),
    verify: jest.fn(() => ({ sub: 123, typ: 'mfa' })),
  },
}));

jest.unstable_mockModule('speakeasy', () => ({
  __esModule: true,
  default: {
    totp: {
      verify: jest.fn(() => true),
    },
  },
}));

const mockCreatePhoneVerification = jest.fn();
const mockConsumePhoneVerification = jest.fn();

jest.unstable_mockModule('../services/authVerification.js', () => ({
  __esModule: true,
  consumeEmailVerification: jest.fn(),
  createPhoneVerification: mockCreatePhoneVerification,
  consumePhoneVerification: mockConsumePhoneVerification,
}));

// Import router AFTER mocks
const { default: authRouter } = await import('../routes/auth.js');

// --- App helper ---------------------------------------------------------------

function createApp() {
  const app = express();

  app.use(express.json());
  app.use('/auth', authRouter);

  app.use((err, _req, res, _next) => {
    return res.status(500).json({
      error: err?.message || 'Internal Server Error',
    });
  });

  return app;
}

beforeEach(() => {
  jest.clearAllMocks();

  mockPhoneOtpCount.mockReset();
  mockPhoneOtpCreate.mockReset();
  mockPhoneOtpFindFirst.mockReset();
  mockPhoneOtpUpdate.mockReset();
  mockPhoneOtpUpdateMany.mockReset();
  mockPhoneOtpDeleteMany.mockReset();

  mockSmsConsentCreate.mockReset();
  mockSmsConsentFindFirst.mockReset();

  mockSendSms.mockReset();
  mockNormalizeE164.mockReset();
  mockNormalizeE164.mockImplementation((phone) => String(phone).trim());

  mockCreatePhoneVerification.mockReset();
  mockConsumePhoneVerification.mockReset();
});

afterEach(() => {
  jest.restoreAllMocks();
});

// --- Tests: POST /auth/send-verify ------------------------------------------

describe('POST /auth/send-verify', () => {
  it('returns 400 when consent is missing or false', async () => {
    const app = createApp();

    const res = await request(app)
      .post('/auth/send-verify')
      .send({
        phone: '+15550001234',
        consent: false,
      });

    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({
      message: 'Consent is required',
    });

    expect(mockCreatePhoneVerification).not.toHaveBeenCalled();
    expect(mockSendSms).not.toHaveBeenCalled();
  });

  it('returns 422 for invalid phone number', async () => {
    const app = createApp();

    const res = await request(app)
      .post('/auth/send-verify')
      .send({
        phone: '12345',
        consent: true,
      });

    expect(res.statusCode).toBe(422);
    expect(res.body).toEqual({
      message: 'Phone must be in E.164 format (e.g. +14155551234)',
    });

    expect(mockCreatePhoneVerification).not.toHaveBeenCalled();
    expect(mockSendSms).not.toHaveBeenCalled();
  });

  it('creates verification through service, sends SMS, and stores provider id', async () => {
    const app = createApp();
    const phone = '+15550001234';

    mockCreatePhoneVerification.mockResolvedValueOnce({
      status: 200,
      id: 10,
      code: '123456',
    });

    mockSendSms.mockResolvedValueOnce({
      messageSid: 'SM123',
    });

    mockPhoneOtpUpdateMany.mockResolvedValueOnce({
      count: 1,
    });

    const res = await request(app)
      .post('/auth/send-verify')
      .set('user-agent', 'jest-agent')
      .send({
        phone,
        consent: true,
      });

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({
      message: 'Verification code sent',
    });

    expect(mockCreatePhoneVerification).toHaveBeenCalledWith({
      phone,
      consentTextVersion: 'v1',
      ipAddress: expect.any(String),
      userAgent: 'jest-agent',
    });

    expect(mockSendSms).toHaveBeenCalledWith({
      to: phone,
      text: expect.stringContaining('123456'),
      clientRef: expect.stringMatching(/^otp:\+15550001234:/),
    });

    expect(mockPhoneOtpUpdateMany).toHaveBeenCalledWith({
      where: { id: 10 },
      data: { providerMessageId: 'SM123' },
    });
  });

  it('returns service status when verification issuance is rate limited', async () => {
    const app = createApp();
    const phone = '+15550001234';

    mockCreatePhoneVerification.mockResolvedValueOnce({
      status: 429,
      message: 'Too many code requests for this phone',
    });

    const res = await request(app)
      .post('/auth/send-verify')
      .send({
        phone,
        consent: true,
      });

    expect(res.statusCode).toBe(429);
    expect(res.body).toEqual({
      message: 'Too many code requests for this phone',
    });

    expect(mockSendSms).not.toHaveBeenCalled();
  });

  it('expires issued OTP and returns 500 when SMS sending fails', async () => {
    const app = createApp();
    const phone = '+15550001234';

    mockCreatePhoneVerification.mockResolvedValueOnce({
      status: 200,
      id: 10,
      code: '123456',
    });

    mockSendSms.mockRejectedValueOnce(new Error('sms failed'));
    mockPhoneOtpUpdateMany.mockResolvedValueOnce({ count: 1 });

    const res = await request(app)
      .post('/auth/send-verify')
      .send({
        phone,
        consent: true,
      });

    expect(res.statusCode).toBe(500);
    expect(res.body).toEqual({
      message: 'Failed to send verification code',
    });

    expect(mockPhoneOtpUpdateMany).toHaveBeenCalledWith({
      where: { id: 10 },
      data: { expiresAt: expect.any(Date) },
    });
  });
});

// --- Tests: POST /auth/verify-phone-code -------------------------------------

describe('POST /auth/verify-phone-code', () => {
  it('returns 422 for invalid input', async () => {
    const app = createApp();

    const res = await request(app)
      .post('/auth/verify-phone-code')
      .send({
        phone: 'bad-phone',
        code: 'abc',
      });

    expect(res.statusCode).toBe(422);
    expect(res.body).toEqual({
      message: 'Invalid input',
    });

    expect(mockConsumePhoneVerification).not.toHaveBeenCalled();
  });

  it('returns service error when no OTP exists', async () => {
    const app = createApp();
    const phone = '+15550001234';

    mockConsumePhoneVerification.mockResolvedValueOnce({
      status: 400,
      message: 'No verification code found',
    });

    const res = await request(app)
      .post('/auth/verify-phone-code')
      .send({
        phone,
        code: '123456',
      });

    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({
      message: 'No verification code found',
    });

    expect(mockConsumePhoneVerification).toHaveBeenCalledWith(
      phone,
      '123456'
    );
  });

  it('returns expired-code response from verification service', async () => {
    const app = createApp();
    const phone = '+15550001234';

    mockConsumePhoneVerification.mockResolvedValueOnce({
      status: 400,
      message: 'Code expired',
    });

    const res = await request(app)
      .post('/auth/verify-phone-code')
      .send({
        phone,
        code: '123456',
      });

    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({
      message: 'Code expired',
    });
  });

  it('returns invalid-code response from verification service', async () => {
    const app = createApp();
    const phone = '+15550001234';

    mockConsumePhoneVerification.mockResolvedValueOnce({
      status: 400,
      message: 'Invalid code',
    });

    const res = await request(app)
      .post('/auth/verify-phone-code')
      .send({
        phone,
        code: '222222',
      });

    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({
      message: 'Invalid code',
    });
  });

  it('returns successful phone verification payload', async () => {
    const app = createApp();
    const phone = '+15550001234';

    mockConsumePhoneVerification.mockResolvedValueOnce({
      status: 200,
      message: 'Phone verified',
      phoneVerificationId: 'proof-token',
      pendingRegistration: null,
    });

    const res = await request(app)
      .post('/auth/verify-phone-code')
      .send({
        phone,
        code: '123456',
      });

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({
      message: 'Phone verified',
      phoneVerificationId: 'proof-token',
      pendingRegistration: null,
    });

    expect(mockConsumePhoneVerification).toHaveBeenCalledWith(
      phone,
      '123456'
    );
  });
});
