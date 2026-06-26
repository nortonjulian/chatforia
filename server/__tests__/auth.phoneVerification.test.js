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

    expect(mockPhoneOtpCreate).not.toHaveBeenCalled();
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

    expect(mockPhoneOtpCreate).not.toHaveBeenCalled();
    expect(mockSendSms).not.toHaveBeenCalled();
  });

  it('creates OTP, records consent, sends SMS, and stores provider message id', async () => {
    const app = createApp();
    const phone = '+15550001234';

    jest.spyOn(Math, 'random').mockReturnValue(0.123456);

    mockPhoneOtpCount.mockResolvedValueOnce(0);
    mockSmsConsentCreate.mockResolvedValueOnce({ id: 1 });
    mockPhoneOtpCreate.mockImplementationOnce(async ({ data }) => ({
      id: 10,
      ...data,
    }));
    mockSendSms.mockResolvedValueOnce({
      messageSid: 'SM123',
    });
    mockPhoneOtpUpdateMany.mockResolvedValueOnce({
      count: 1,
    });

    const pendingRegistration = {
      username: 'julian',
      email: 'julian@example.com',
    };

    const res = await request(app)
      .post('/auth/send-verify')
      .set('user-agent', 'jest-agent')
      .send({
        phone,
        consent: true,
        pendingRegistration,
      });

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({
      message: 'Verification code sent',
    });

    expect(mockNormalizeE164).toHaveBeenCalledWith(phone);

    expect(mockPhoneOtpCount).toHaveBeenCalledWith({
      where: {
        phone,
        createdAt: {
          gt: expect.any(Date),
        },
      },
    });

    expect(mockSmsConsentCreate).toHaveBeenCalledWith({
      data: {
        phone,
        pendingRegistration,
        consentTextVersion: 'v1',
        ipAddress: expect.any(String),
        userAgent: 'jest-agent',
      },
    });

    expect(mockPhoneOtpCreate).toHaveBeenCalledTimes(1);

    const createArg = mockPhoneOtpCreate.mock.calls[0][0];

    expect(createArg.data).toMatchObject({
      phone,
      otpCode: expect.stringMatching(/^\d{6}$/),
      expiresAt: expect.any(Date),
    });

    expect(mockSendSms).toHaveBeenCalledTimes(1);

    const smsArg = mockSendSms.mock.calls[0][0];

    expect(smsArg).toMatchObject({
      to: phone,
      text: expect.stringMatching(
        /^Chatforia: Your verification code is \d{6}\./
      ),
      clientRef: expect.stringMatching(/^otp:\+15550001234:/),
    });

    expect(mockPhoneOtpUpdateMany).toHaveBeenCalledWith({
      where: {
        phone,
        otpCode: createArg.data.otpCode,
      },
      data: {
        providerMessageId: 'SM123',
      },
    });
  });

  it('returns 429 when too many recent code requests exist for phone', async () => {
    const app = createApp();
    const phone = '+15550001234';

    mockPhoneOtpCount.mockResolvedValueOnce(5);

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

    expect(mockSmsConsentCreate).not.toHaveBeenCalled();
    expect(mockPhoneOtpCreate).not.toHaveBeenCalled();
    expect(mockSendSms).not.toHaveBeenCalled();
  });

  it('returns 500 when SMS sending fails', async () => {
    const app = createApp();
    const phone = '+15550001234';

    mockPhoneOtpCount.mockResolvedValueOnce(0);
    mockSmsConsentCreate.mockResolvedValueOnce({ id: 1 });
    mockPhoneOtpCreate.mockResolvedValueOnce({
      id: 10,
      phone,
      otpCode: '123456',
      expiresAt: new Date(Date.now() + 10 * 60 * 1000),
    });
    mockSendSms.mockRejectedValueOnce(new Error('sms failed'));

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

    expect(mockPhoneOtpFindFirst).not.toHaveBeenCalled();
  });

  it('returns 400 when no OTP exists', async () => {
    const app = createApp();
    const phone = '+15550001234';

    mockPhoneOtpFindFirst.mockResolvedValueOnce(null);

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

    expect(mockPhoneOtpFindFirst).toHaveBeenCalledWith({
      where: { phone },
      orderBy: { createdAt: 'desc' },
    });
  });

  it('returns 400 and deletes OTP when code is expired', async () => {
    const app = createApp();
    const phone = '+15550001234';

    mockPhoneOtpFindFirst.mockResolvedValueOnce({
      id: 22,
      phone,
      otpCode: '123456',
      expiresAt: new Date(Date.now() - 60 * 1000),
      attempts: 0,
    });

    mockPhoneOtpDeleteMany.mockResolvedValueOnce({
      count: 1,
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

    expect(mockPhoneOtpDeleteMany).toHaveBeenCalledWith({
      where: { id: 22 },
    });
  });

  it('returns 400 and increments attempts when code is wrong', async () => {
    const app = createApp();
    const phone = '+15550001234';

    mockPhoneOtpFindFirst.mockResolvedValueOnce({
      id: 33,
      phone,
      otpCode: '111111',
      expiresAt: new Date(Date.now() + 10 * 60 * 1000),
      attempts: 2,
    });

    mockPhoneOtpUpdate.mockResolvedValueOnce({
      id: 33,
      attempts: 3,
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

    expect(mockPhoneOtpUpdate).toHaveBeenCalledWith({
      where: { id: 33 },
      data: { attempts: 3 },
    });
  });

  it('verifies code, deletes OTP, and returns pending registration from latest consent', async () => {
    const app = createApp();
    const phone = '+15550001234';

    const pendingRegistration = {
      username: 'julian',
      email: 'julian@example.com',
    };

    mockPhoneOtpFindFirst.mockResolvedValueOnce({
      id: 44,
      phone,
      otpCode: '123456',
      expiresAt: new Date(Date.now() + 10 * 60 * 1000),
      attempts: 0,
    });

    mockPhoneOtpDeleteMany.mockResolvedValueOnce({
      count: 1,
    });

    mockSmsConsentFindFirst.mockResolvedValueOnce({
      id: 99,
      phone,
      pendingRegistration,
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
      pendingRegistration,
    });

    expect(mockPhoneOtpDeleteMany).toHaveBeenCalledWith({
      where: { id: 44 },
    });

    expect(mockSmsConsentFindFirst).toHaveBeenCalledWith({
      where: { phone },
      orderBy: { createdAt: 'desc' },
    });
  });

  it('verifies code and returns pendingRegistration null when no consent exists', async () => {
    const app = createApp();
    const phone = '+15550001234';

    mockPhoneOtpFindFirst.mockResolvedValueOnce({
      id: 55,
      phone,
      otpCode: '654321',
      expiresAt: new Date(Date.now() + 10 * 60 * 1000),
      attempts: 0,
    });

    mockPhoneOtpDeleteMany.mockResolvedValueOnce({
      count: 1,
    });

    mockSmsConsentFindFirst.mockResolvedValueOnce(null);

    const res = await request(app)
      .post('/auth/verify-phone-code')
      .send({
        phone,
        code: '654321',
      });

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({
      message: 'Phone verified',
      pendingRegistration: null,
    });
  });
});