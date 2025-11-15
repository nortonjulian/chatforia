import { jest, describe, it, expect, beforeEach } from '@jest/globals';
import express from 'express';
import request from 'supertest';

// --- Mocks -------------------------------------------------------------------

// prisma.user methods
const mockUserFindUnique = jest.fn();
const mockUserCreate = jest.fn();
const mockUserUpdate = jest.fn();

// bcrypt.hash
const mockHash = jest.fn();

// registration validator
const mockValidateRegistrationInput = jest.fn();

// Upload / AV / download mocks (imported but not used in the shown routes)
jest.unstable_mockModule('../middleware/uploads.js', () => ({
  uploadAvatar: {
    single: () => (req, res, next) => next(),
  },
  uploadDirs: {},
}));

jest.unstable_mockModule('../utils/antivirus.js', () => ({
  scanFile: jest.fn(),
}));

jest.unstable_mockModule('../utils/downloadTokens.js', () => ({
  signDownloadToken: jest.fn(),
}));

// prisma client
jest.unstable_mockModule('../utils/prismaClient.js', () => ({
  default: {
    user: {
      findUnique: mockUserFindUnique,
      create: mockUserCreate,
      update: mockUserUpdate,
    },
  },
}));

// bcrypt
jest.unstable_mockModule('bcrypt', () => ({
  default: {
    hash: mockHash,
  },
}));

// auth – just pass through; we'll inject req.user in createApp when needed
jest.unstable_mockModule('../middleware/auth.js', () => ({
  requireAuth: (req, res, next) => next(),
}));

// validation
jest.unstable_mockModule('../utils/validateUser.js', () => ({
  validateRegistrationInput: mockValidateRegistrationInput,
}));

// Import router AFTER mocks
const { default: usersRouter } = await import('../routes/users.js');

// --- Helper: build app -------------------------------------------------------

function createApp({ user } = {}) {
  const app = express();
  app.use(express.json());

  app.use((req, res, next) => {
    if (user) req.user = user;
    next();
  });

  app.use('/users', usersRouter);
  return app;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockUserFindUnique.mockReset();
  mockUserCreate.mockReset();
  mockUserUpdate.mockReset();
  mockHash.mockReset();
  mockValidateRegistrationInput.mockReset();
});

// --- Tests: POST /users ------------------------------------------------------

describe('POST /users', () => {
  it('returns 400 when validation fails', async () => {
    mockValidateRegistrationInput.mockReturnValue('Invalid email');

    const app = createApp();

    const res = await request(app)
      .post('/users')
      .send({ username: 'test', email: 'bad-email', password: 'pw' });

    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({ error: 'Invalid email' });

    expect(mockUserFindUnique).not.toHaveBeenCalled();
    expect(mockUserCreate).not.toHaveBeenCalled();
  });

  it('returns 409 when email is already in use', async () => {
    mockValidateRegistrationInput.mockReturnValue(null);
    mockUserFindUnique.mockResolvedValueOnce({ id: 1, email: 'test@example.com' });

    const app = createApp();

    const res = await request(app)
      .post('/users')
      .send({ username: 'test', email: 'test@example.com', password: 'secret' });

    expect(res.statusCode).toBe(409);
    expect(res.body).toEqual({ error: 'Email already in use' });

    expect(mockUserFindUnique).toHaveBeenCalledWith({
      where: { email: 'test@example.com' },
    });
    expect(mockUserCreate).not.toHaveBeenCalled();
  });

  it('creates a user, hashes password, and omits it from response', async () => {
    mockValidateRegistrationInput.mockReturnValue(null);
    mockUserFindUnique.mockResolvedValueOnce(null);

    mockHash.mockResolvedValueOnce('hashed-password');

    const createdUser = {
      id: 42,
      username: 'alice',
      email: 'alice@example.com',
      password: 'hashed-password',
      role: 'USER',
    };

    mockUserCreate.mockResolvedValueOnce(createdUser);

    const app = createApp();

    const res = await request(app)
      .post('/users')
      .send({ username: 'alice', email: 'alice@example.com', password: 'secret' });

    expect(res.statusCode).toBe(201);
    expect(res.body).toEqual({
      id: 42,
      username: 'alice',
      email: 'alice@example.com',
      role: 'USER',
    });
    expect(res.body.password).toBeUndefined();

    expect(mockHash).toHaveBeenCalledWith('secret', 10);
    expect(mockUserCreate).toHaveBeenCalledWith({
      data: {
        username: 'alice',
        email: 'alice@example.com',
        password: 'hashed-password',
        role: 'USER',
      },
    });
  });

  it('returns 500 when prisma.user.create throws', async () => {
    mockValidateRegistrationInput.mockReturnValue(null);
    mockUserFindUnique.mockResolvedValueOnce(null);
    mockHash.mockResolvedValueOnce('hashed-password');
    mockUserCreate.mockRejectedValueOnce(new Error('DB error'));

    const app = createApp();

    const res = await request(app)
      .post('/users')
      .send({ username: 'bob', email: 'bob@example.com', password: 'secret' });

    expect(res.statusCode).toBe(500);
    expect(res.body).toEqual({ error: 'Failed to create user' });
  });
});

// --- Tests: PATCH /users/me --------------------------------------------------

describe('PATCH /users/me', () => {
  it('returns 403 when req.user is missing', async () => {
    const app = createApp(); // no user injected

    const res = await request(app)
      .patch('/users/me')
      .send({ enableSmartReplies: true });

    expect(res.statusCode).toBe(403);
    expect(res.body).toEqual({ error: 'Not authenticated' });
    expect(mockUserUpdate).not.toHaveBeenCalled();
  });

  it('updates basic boolean and string fields', async () => {
    const user = { id: 123, plan: 'FREE' };

    const body = {
      enableSmartReplies: true,
      showReadReceipts: false,
      allowExplicitContent: true,
      privacyBlurEnabled: true,
      privacyBlurOnUnfocus: false,
      privacyHoldToReveal: true,
      notifyOnCopy: false,
      preferredLanguage: '  en-US   ',
      strictE2EE: true,
      cycling: true,
    };

    const updated = {
      id: 123,
      enableSmartReplies: true,
      showReadReceipts: false,
      allowExplicitContent: true,
      privacyBlurEnabled: true,
      privacyBlurOnUnfocus: false,
      privacyHoldToReveal: true,
      notifyOnCopy: false,
      preferredLanguage: 'en-US',
      strictE2EE: true,
      theme: null,
      cycling: true,
      ageBand: null,
      ageAttestedAt: null,
      wantsAgeFilter: false,
      randomChatAllowedBands: [],
    };

    mockUserUpdate.mockResolvedValueOnce(updated);

    const app = createApp({ user });

    const res = await request(app)
      .patch('/users/me')
      .send(body);

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual(updated);

    const call = mockUserUpdate.mock.calls[0][0];
    expect(call.where).toEqual({ id: 123 });
    expect(call.data).toMatchObject({
      enableSmartReplies: true,
      showReadReceipts: false,
      allowExplicitContent: true,
      privacyBlurEnabled: true,
      privacyBlurOnUnfocus: false,
      privacyHoldToReveal: true,
      notifyOnCopy: false,
      preferredLanguage: 'en-US',
      strictE2EE: true,
      cycling: true,
    });
  });

  it('returns 400 for invalid theme', async () => {
    const user = { id: 123, plan: 'FREE' };
    const app = createApp({ user });

    const res = await request(app)
      .patch('/users/me')
      .send({ theme: 'banana' });

    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({ error: 'Invalid theme' });
    expect(mockUserUpdate).not.toHaveBeenCalled();
  });

  it('returns 402 when premium theme is requested on FREE plan', async () => {
    const user = { id: 123, plan: 'FREE' };

    // theme check queries the user plan via prisma
    mockUserFindUnique.mockResolvedValueOnce({ plan: 'FREE' });

    const app = createApp({ user });

    const res = await request(app)
      .patch('/users/me')
      .send({ theme: 'amoled' });

    expect(res.statusCode).toBe(402);
    expect(res.body).toEqual({
      error: 'Premium theme requires an upgraded plan',
    });

    expect(mockUserFindUnique).toHaveBeenCalledWith({
      where: { id: 123 },
      select: { plan: true },
    });
    expect(mockUserUpdate).not.toHaveBeenCalled();
  });

  it('allows premium theme when user has PREMIUM plan', async () => {
    const user = { id: 200, plan: 'PREMIUM' };

    mockUserFindUnique.mockResolvedValueOnce({ plan: 'PREMIUM' });

    const updated = {
      id: 200,
      enableSmartReplies: false,
      showReadReceipts: true,
      allowExplicitContent: false,
      privacyBlurEnabled: false,
      privacyBlurOnUnfocus: false,
      privacyHoldToReveal: false,
      notifyOnCopy: false,
      preferredLanguage: null,
      strictE2EE: false,
      theme: 'amoled',
      cycling: false,
      ageBand: null,
      ageAttestedAt: null,
      wantsAgeFilter: false,
      randomChatAllowedBands: [],
    };

    mockUserUpdate.mockResolvedValueOnce(updated);

    const app = createApp({ user });

    const res = await request(app)
      .patch('/users/me')
      .send({ theme: 'amoled' });

    expect(res.statusCode).toBe(200);
    expect(res.body.theme).toBe('amoled');

    const call = mockUserUpdate.mock.calls[0][0];
    expect(call.data.theme).toBe('amoled');
  });

  it('forces teen isolation and age filter for TEEN_13_17 with randomChatAllowedBands', async () => {
    const user = { id: 300, plan: 'FREE' };

    const updated = {
      id: 300,
      enableSmartReplies: false,
      showReadReceipts: false,
      allowExplicitContent: false,
      privacyBlurEnabled: false,
      privacyBlurOnUnfocus: false,
      privacyHoldToReveal: false,
      notifyOnCopy: false,
      preferredLanguage: null,
      strictE2EE: false,
      theme: null,
      cycling: false,
      ageBand: 'TEEN_13_17',
      ageAttestedAt: new Date(),
      wantsAgeFilter: true,
      randomChatAllowedBands: ['TEEN_13_17'],
    };

    mockUserUpdate.mockResolvedValueOnce(updated);

    const app = createApp({ user });

    const res = await request(app)
      .patch('/users/me')
      .send({
        ageBand: 'TEEN_13_17',
        randomChatAllowedBands: ['TEEN_13_17', 'ADULT_18_24'],
      });

    expect(res.statusCode).toBe(200);

    const call = mockUserUpdate.mock.calls[0][0];
    const data = call.data;

    expect(data.ageBand).toBe('TEEN_13_17');
    expect(data.ageAttestedAt).toBeInstanceOf(Date);
    expect(data.randomChatAllowedBands).toEqual(['TEEN_13_17']);
    expect(data.wantsAgeFilter).toBe(true);
  });

  it('filters out TEEN_13_17 for adult users randomChatAllowedBands', async () => {
    const user = { id: 400, plan: 'FREE' };

    // No ageBand in body, so it will look up current ageBand
    mockUserFindUnique.mockResolvedValueOnce({ ageBand: 'ADULT_25_34' });

    const updated = {
      id: 400,
      enableSmartReplies: false,
      showReadReceipts: false,
      allowExplicitContent: false,
      privacyBlurEnabled: false,
      privacyBlurOnUnfocus: false,
      privacyHoldToReveal: false,
      notifyOnCopy: false,
      preferredLanguage: null,
      strictE2EE: false,
      theme: null,
      cycling: false,
      ageBand: 'ADULT_25_34',
      ageAttestedAt: null,
      wantsAgeFilter: false,
      randomChatAllowedBands: ['ADULT_25_34'],
    };

    mockUserUpdate.mockResolvedValueOnce(updated);

    const app = createApp({ user });

    const res = await request(app)
      .patch('/users/me')
      .send({
        randomChatAllowedBands: ['TEEN_13_17', 'ADULT_25_34'],
      });

    expect(res.statusCode).toBe(200);

    const call = mockUserUpdate.mock.calls[0][0];
    expect(call.data.randomChatAllowedBands).toEqual(['ADULT_25_34']);
    // ensure we did a lookup
    expect(mockUserFindUnique).toHaveBeenCalledWith({
      where: { id: 400 },
      select: { ageBand: true },
    });
  });

  it('returns 400 when no valid fields are provided', async () => {
    const user = { id: 500, plan: 'FREE' };
    const app = createApp({ user });

    const res = await request(app)
      .patch('/users/me')
      .send({ someUnknownField: 'value' });

    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({ error: 'No valid fields to update' });
    expect(mockUserUpdate).not.toHaveBeenCalled();
  });

  it('returns 500 when prisma.user.update fails', async () => {
    const user = { id: 600, plan: 'FREE' };

    mockUserUpdate.mockRejectedValueOnce(new Error('db write fail'));

    const app = createApp({ user });

    const res = await request(app)
      .patch('/users/me')
      .send({ enableSmartReplies: true });

    expect(res.statusCode).toBe(500);
    expect(res.body).toEqual({
      error: 'Failed to update profile (db write failed)',
    });
  });
});
