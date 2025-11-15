import { jest, describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import express from 'express';
import request from 'supertest';
import crypto from 'crypto';

// --- Prisma mocks ------------------------------------------------------------

const mockUserFindFirst = jest.fn();
const mockVerificationCreate = jest.fn();
const mockVerificationFindFirst = jest.fn();
const mockVerificationUpdate = jest.fn();
const mockUserUpdate = jest.fn();
const mockTransaction = jest.fn((ops) => Promise.all(ops));

const mockPrismaInstance = {
  user: {
    findFirst: mockUserFindFirst,
    update: mockUserUpdate,
  },
  verificationToken: {
    create: mockVerificationCreate,
    findFirst: mockVerificationFindFirst,
    update: mockVerificationUpdate,
  },
  $transaction: mockTransaction,
};

// paths are from server/__tests__ → server/utils/...
jest.unstable_mockModule('../utils/prismaClient.js', () => ({
  __esModule: true,
  default: mockPrismaInstance,
}));

// --- sendMail mock -----------------------------------------------------------

const mockSendMail = jest.fn();

jest.unstable_mockModule('../utils/sendMail.js', () => ({
  __esModule: true,
  sendMail: mockSendMail,
}));

// Import router AFTER mocks
const emailModule = await import('../routes/auth/emailVerification.js');
const emailRouter = emailModule.router || emailModule.default;

// --- Helper: build app -------------------------------------------------------

function createApp() {
  const app = express();
  app.use(express.json());
  app.use('/auth', emailRouter);
  return app;
}

const ORIGINAL_BASE_URL = process.env.PUBLIC_BASE_URL;

beforeEach(() => {
  jest.clearAllMocks();
  mockUserFindFirst.mockReset();
  mockVerificationCreate.mockReset();
  mockVerificationFindFirst.mockReset();
  mockVerificationUpdate.mockReset();
  mockUserUpdate.mockReset();
  mockTransaction.mockReset();
  mockSendMail.mockReset();

  process.env.PUBLIC_BASE_URL = 'https://app.example.com/';
});

afterEach(() => {
  process.env.PUBLIC_BASE_URL = ORIGINAL_BASE_URL;
});

// --- Tests: POST /auth/email/send --------------------------------------------

describe('POST /auth/email/send', () => {
  it('returns 400 when email is missing', async () => {
    const app = createApp();

    const res = await request(app)
      .post('/auth/email/send')
      .send({}); // no email

    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({ ok: false, error: 'Missing email' });

    expect(mockUserFindFirst).not.toHaveBeenCalled();
    expect(mockVerificationCreate).not.toHaveBeenCalled();
    expect(mockSendMail).not.toHaveBeenCalled();
  });

  it('returns ok:true and does nothing if user not found (no user enumeration)', async () => {
    const app = createApp();

    mockUserFindFirst.mockResolvedValueOnce(null);

    const res = await request(app)
      .post('/auth/email/send')
      .send({ email: 'nobody@example.com' });

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ ok: true });

    expect(mockUserFindFirst).toHaveBeenCalledWith({
      where: { email: { equals: 'nobody@example.com', mode: 'insensitive' } },
      select: { id: true, email: true },
    });
    expect(mockVerificationCreate).not.toHaveBeenCalled();
    expect(mockSendMail).not.toHaveBeenCalled();
  });

  it('creates verification token and sends email when user exists', async () => {
    const app = createApp();

    const user = { id: 42, email: 'alice@example.com' };
    mockUserFindFirst.mockResolvedValueOnce(user);

    mockVerificationCreate.mockImplementationOnce(({ data }) => ({
      id: 1,
      ...data,
    }));

    mockSendMail.mockResolvedValueOnce({ previewUrl: 'http://preview-link' });

    const res = await request(app)
      .post('/auth/email/send')
      .send({ email: 'Alice@Example.com' }); // case-insensitive lookup

    expect(res.statusCode).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.previewUrl).toBe('http://preview-link');

    // user lookup
    expect(mockUserFindFirst).toHaveBeenCalledWith({
      where: {
        email: { equals: 'Alice@Example.com', mode: 'insensitive' },
      },
      select: { id: true, email: true },
    });

    // verification token created
    expect(mockVerificationCreate).toHaveBeenCalledTimes(1);
    const createArgs = mockVerificationCreate.mock.calls[0][0];
    expect(createArgs.data.userId).toBe(42);
    expect(createArgs.data.type).toBe('EMAIL');
    expect(typeof createArgs.data.tokenHash).toBe('string');
    expect(createArgs.data.tokenHash).toHaveLength(64);
    expect(createArgs.data.expiresAt).toBeInstanceOf(Date);

    // sendMail called with proper args
    expect(mockSendMail).toHaveBeenCalledTimes(1);
    const mailArgs = mockSendMail.mock.calls[0];

    expect(mailArgs[0]).toBe('alice@example.com'); // normalized from DB
    expect(mailArgs[1]).toBe('Verify your email');

    const html = mailArgs[2];
    expect(html).toContain('Verify your email for Chatforia');
    expect(html).toContain('Verify Email');

    // link should be based on PUBLIC_BASE_URL
    // and include /verify-email?token=...
    expect(html).toMatch(
      /https:\/\/app\.example\.com\/verify-email\?token=[^"]+/
    );
  });
});

// --- Tests: GET /auth/email/verify -------------------------------------------

describe('GET /auth/email/verify', () => {
  it('returns 400 when token is missing', async () => {
    const app = createApp();

    const res = await request(app).get('/auth/email/verify');

    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({ ok: false, error: 'Missing token' });
  });

  it('returns 400 invalid when token not found in DB', async () => {
    const app = createApp();

    mockVerificationFindFirst.mockResolvedValueOnce(null);

    const res = await request(app)
      .get('/auth/email/verify')
      .query({ token: 'some-token' });

    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({ ok: false, error: 'invalid' });

    // We can at least assert a hash of the provided token was used
    expect(mockVerificationFindFirst).toHaveBeenCalledTimes(1);
    const where = mockVerificationFindFirst.mock.calls[0][0].where;
    const expectedHash = crypto
      .createHash('sha256')
      .update('some-token', 'utf8')
      .digest('hex');

    expect(where.tokenHash).toBe(expectedHash);
    expect(where.type).toBe('EMAIL');
    expect(where.usedAt).toBeNull();
  });

  it('returns 400 expired when token is past its expiry', async () => {
    const app = createApp();

    const token = 'expired-token';
    const tokenHash = crypto
      .createHash('sha256')
      .update(token, 'utf8')
      .digest('hex');

    const past = new Date(Date.now() - 60 * 1000);

    mockVerificationFindFirst.mockResolvedValueOnce({
      id: 10,
      userId: 7,
      expiresAt: past,
    });

    const res = await request(app)
      .get('/auth/email/verify')
      .query({ token });

    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({ ok: false, error: 'expired' });

    const where = mockVerificationFindFirst.mock.calls[0][0].where;
    expect(where.tokenHash).toBe(tokenHash);
  });

  it('marks email verified and token used when token is valid', async () => {
    const app = createApp();

    const token = 'valid-token';
    const tokenHash = crypto
      .createHash('sha256')
      .update(token, 'utf8')
      .digest('hex');

    const future = new Date(Date.now() + 60 * 60 * 1000);

    mockVerificationFindFirst.mockResolvedValueOnce({
      id: 20,
      userId: 99,
      expiresAt: future,
    });

    mockUserUpdate.mockResolvedValueOnce({});
    mockVerificationUpdate.mockResolvedValueOnce({});
    mockTransaction.mockResolvedValueOnce([]);

    const res = await request(app)
      .get('/auth/email/verify')
      .query({ token });

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ ok: true });

    expect(mockVerificationFindFirst).toHaveBeenCalledWith({
      where: { tokenHash, type: 'EMAIL', usedAt: null },
      select: { id: true, userId: true, expiresAt: true },
    });

    // Updates run inside a transaction but we can still assert the calls
    expect(mockUserUpdate).toHaveBeenCalledTimes(1);
    const userUpdateArgs = mockUserUpdate.mock.calls[0][0];
    expect(userUpdateArgs.where).toEqual({ id: 99 });
    expect(userUpdateArgs.data).toHaveProperty('emailVerifiedAt');
    expect(userUpdateArgs.data).toHaveProperty('emailVerifiedIp', null);

    expect(mockVerificationUpdate).toHaveBeenCalledTimes(1);
    const vtUpdateArgs = mockVerificationUpdate.mock.calls[0][0];
    expect(vtUpdateArgs.where).toEqual({ id: 20 });
    expect(vtUpdateArgs.data).toHaveProperty('usedAt');

    expect(mockTransaction).toHaveBeenCalledTimes(1);
  });
});
