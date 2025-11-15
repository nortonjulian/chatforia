import { jest, describe, it, expect, beforeEach } from '@jest/globals';
import express from 'express';
import request from 'supertest';
import crypto from 'crypto';

// --- Prisma mocks ------------------------------------------------------------

const mockVerificationDeleteMany = jest.fn();
const mockVerificationCreate = jest.fn();
const mockVerificationFindFirst = jest.fn();
const mockVerificationUpdate = jest.fn();
const mockUserUpdate = jest.fn();
const mockTransaction = jest.fn((ops) => Promise.all(ops));

const mockPrismaInstance = {
  verificationToken: {
    deleteMany: mockVerificationDeleteMany,
    create: mockVerificationCreate,
    findFirst: mockVerificationFindFirst,
    update: mockVerificationUpdate,
  },
  user: {
    update: mockUserUpdate,
  },
  $transaction: mockTransaction,
};

jest.unstable_mockModule('../utils/prismaClient.js', () => ({
  __esModule: true,
  default: mockPrismaInstance,
}));

// --- telco / sms mock --------------------------------------------------------

const mockSendSms = jest.fn();

jest.unstable_mockModule('../lib/telco/index.js', () => ({
  __esModule: true,
  sendSms: mockSendSms,
}));

// --- IP mock -----------------------------------------------------------------

jest.unstable_mockModule('../utils/ip.js', () => ({
  __esModule: true,
  getClientIp: () => '203.0.113.1',
}));

// --- auth mock ---------------------------------------------------------------

jest.unstable_mockModule('../../middleware/auth.js', () => ({
  __esModule: true,
  requireAuth: (req, res, next) => {
    if (!req.user) req.user = { id: 123 };
    next();
  },
}));

// Import router + memTokens AFTER mocks
const authModule = await import('../routes/auth/phoneVerification.js');
const phoneRouter = authModule.default;
const { memTokens } = authModule;

// --- Helper: app builder -----------------------------------------------------

function createApp({ user } = {}) {
  const app = express();
  app.use(express.json());

  // Shared session object to simulate persistent session across requests
  const session = {};

  app.use((req, res, next) => {
    if (user) req.user = user;
    req.session = session;
    next();
  });

  app.use('/auth/phone', phoneRouter);
  return app;
}

// local sha256 to match route logic
function sha256Local(s) {
  return crypto.createHash('sha256').update(String(s), 'utf8').digest('hex');
}

beforeEach(() => {
  jest.clearAllMocks();
  mockVerificationDeleteMany.mockReset();
  mockVerificationCreate.mockReset();
  mockVerificationFindFirst.mockReset();
  mockVerificationUpdate.mockReset();
  mockUserUpdate.mockReset();
  mockTransaction.mockReset();
  mockSendSms.mockReset();
  memTokens.clear();
});

// --- Tests: POST /auth/phone/start -------------------------------------------

describe('POST /auth/phone/start', () => {
  it('returns 400 for invalid phone number', async () => {
    const app = createApp({ user: { id: 1 } });

    const res = await request(app)
      .post('/auth/phone/start')
      .send({ phoneNumber: '12345' }); // not E.164-ish

    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({ ok: false, reason: 'invalid_phone' });

    expect(mockVerificationCreate).not.toHaveBeenCalled();
    expect(mockSendSms).not.toHaveBeenCalled();
  });

  it('writes token via Prisma when DB is OK and sends SMS', async () => {
    const app = createApp({ user: { id: 42 } });

    mockVerificationDeleteMany.mockResolvedValueOnce({ count: 0 });
    let capturedTokenHash = null;

    mockVerificationCreate.mockImplementationOnce(({ data }) => {
      capturedTokenHash = data.tokenHash;
      return { id: 1, ...data };
    });

    mockUserUpdate.mockResolvedValueOnce({});

    const res = await request(app)
      .post('/auth/phone/start')
      .send({ phoneNumber: '+1 555 000 1234' });

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ ok: true });

    expect(mockVerificationDeleteMany).toHaveBeenCalledWith({
      where: { userId: 42, type: 'PHONE', usedAt: null },
    });

    expect(mockVerificationCreate).toHaveBeenCalledTimes(1);
    expect(typeof capturedTokenHash).toBe('string');
    expect(capturedTokenHash).toHaveLength(64); // sha256 hex

    // phoneNumber best-effort update
    expect(mockUserUpdate).toHaveBeenCalledWith({
      where: { id: 42 },
      data: { phoneNumber: '+1 555 000 1234' },
    });

    // SMS sent
    expect(mockSendSms).toHaveBeenCalledTimes(1);
    const smsArgs = mockSendSms.mock.calls[0][0];
    expect(smsArgs.to).toBe('+1 555 000 1234');
    expect(smsArgs.text).toMatch(/Your Chatforia code is \d{6}/);

    // since Prisma succeeded, memTokens should be empty
    expect(memTokens.size).toBe(0);
  });

  it('falls back to memTokens when Prisma create fails', async () => {
    const userId = 99;
    const phone = '+1 555 111 2222';
    const app = createApp({ user: { id: userId } });

    mockVerificationDeleteMany.mockResolvedValueOnce({ count: 0 });
    // both canonical + alt shapes fail
    mockVerificationCreate
      .mockRejectedValueOnce(new Error('no type'))
      .mockRejectedValueOnce(new Error('no kind'));

    mockUserUpdate.mockRejectedValueOnce(new Error('no column'));

    const res = await request(app)
      .post('/auth/phone/start')
      .send({ phoneNumber: phone });

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ ok: true });

    // Prisma create called twice (type/kind), both failed
    expect(mockVerificationCreate).toHaveBeenCalledTimes(2);

    // memTokens has an entry
    expect(memTokens.has(userId)).toBe(true);
    const tok = memTokens.get(userId);
    expect(tok.phone).toBe(phone);
    expect(typeof tok.tokenHash).toBe('string');
    expect(tok.tokenHash).toHaveLength(64);
    expect(tok.usedAt).toBeNull();
    expect(tok.expiresAt instanceof Date || typeof tok.expiresAt === 'object').toBe(true);

    // SMS still sent
    expect(mockSendSms).toHaveBeenCalledTimes(1);
  });
});

// --- Tests: POST /auth/phone/verify -----------------------------------------

describe('POST /auth/phone/verify', () => {
  it('verifies successfully using DB token', async () => {
    const userId = 123;
    const app = createApp({ user: { id: userId } });

    const code = '123456';
    const tokenHash = sha256Local(code);
    const future = new Date(Date.now() + 10 * 60 * 1000);

    mockVerificationFindFirst.mockResolvedValueOnce({
      id: 1,
      userId,
      type: 'PHONE',
      tokenHash,
      expiresAt: future,
      usedAt: null,
    });

    mockTransaction.mockResolvedValueOnce([]);

    const res = await request(app)
      .post('/auth/phone/verify')
      .send({ code });

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ ok: true });

    expect(mockVerificationFindFirst).toHaveBeenCalledWith({
      where: { userId, type: 'PHONE', usedAt: null },
      orderBy: { createdAt: 'desc' },
    });

    expect(mockTransaction).toHaveBeenCalledTimes(1);
    expect(mockVerificationUpdate).toHaveBeenCalled();
    expect(mockUserUpdate).toHaveBeenCalled();
  });

  it('verifies successfully using in-memory token when DB is unavailable', async () => {
    const userId = 321;
    const app = createApp({ user: { id: userId } });

    const code = '765432';
    const tokenHash = sha256Local(code);
    const future = new Date(Date.now() + 10 * 60 * 1000);

    // DB path fails/empty
    mockVerificationFindFirst.mockResolvedValueOnce(null);

    memTokens.set(userId, {
      tokenHash,
      expiresAt: future,
      usedAt: null,
      phone: '+1 555 999 8888',
    });

    const res = await request(app)
      .post('/auth/phone/verify')
      .send({ code });

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ ok: true });

    // No transaction (DB token not used)
    expect(mockTransaction).not.toHaveBeenCalled();
    expect(mockUserUpdate).toHaveBeenCalled();

    const memTok = memTokens.get(userId);
    expect(memTok.usedAt).toBeInstanceOf(Date);
  });

  it('returns expired when no token exists in DB or memory', async () => {
    const userId = 777;
    const app = createApp({ user: { id: userId } });

    mockVerificationFindFirst.mockResolvedValueOnce(null);

    const res = await request(app)
      .post('/auth/phone/verify')
      .send({ code: '000000' });

    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({ ok: false, reason: 'expired' });
  });

  it('returns bad_code when tokenHash does not match (DB path)', async () => {
    const userId = 888;
    const app = createApp({ user: { id: userId } });

    const correctCode = '111111';
    const wrongCode = '222222';

    const tokenHash = sha256Local(correctCode);
    const future = new Date(Date.now() + 10 * 60 * 1000);

    mockVerificationFindFirst.mockResolvedValueOnce({
      id: 5,
      userId,
      type: 'PHONE',
      tokenHash,
      expiresAt: future,
      usedAt: null,
    });

    const res = await request(app)
      .post('/auth/phone/verify')
      .send({ code: wrongCode });

    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({ ok: false, reason: 'bad_code' });
  });

  it('throttles attempts and returns too_many_attempts after MAX_ATTEMPTS', async () => {
    const userId = 999;
    const app = createApp({ user: { id: userId } });

    const correctCode = '333333';
    const wrongCode = '444444';
    const tokenHash = sha256Local(correctCode);
    const future = new Date(Date.now() + 10 * 60 * 1000);

    // Force memory path (no DB token)
    mockVerificationFindFirst.mockResolvedValue(null);
    memTokens.set(userId, {
      tokenHash,
      expiresAt: future,
      usedAt: null,
      phone: '+1 555 000 0000',
    });

    // First 5 attempts: bad_code
    for (let i = 0; i < 5; i++) {
      const r = await request(app)
        .post('/auth/phone/verify')
        .send({ code: wrongCode });

      expect(r.statusCode).toBe(400);
      expect(r.body.reason).toBe('bad_code');
    }

    // 6th attempt: throttled
    const res6 = await request(app)
      .post('/auth/phone/verify')
      .send({ code: wrongCode });

    expect(res6.statusCode).toBe(429);
    expect(res6.body).toEqual({
      ok: false,
      reason: 'too_many_attempts',
    });
  });

  it('treats expired token as expired (memory path)', async () => {
    const userId = 444;
    const app = createApp({ user: { id: userId } });

    const code = '555555';
    const tokenHash = sha256Local(code);
    const past = new Date(Date.now() - 60 * 1000);

    mockVerificationFindFirst.mockResolvedValueOnce(null);

    memTokens.set(userId, {
      tokenHash,
      expiresAt: past, // already expired
      usedAt: null,
      phone: '+1 555 123 0000',
    });

    const res = await request(app)
      .post('/auth/phone/verify')
      .send({ code });

    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({ ok: false, reason: 'expired' });
  });
});
