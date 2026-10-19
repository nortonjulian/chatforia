import { jest, describe, it, expect, beforeEach } from '@jest/globals';
import express from 'express';
import request from 'supertest';

// --- Mocks -------------------------------------------------------------------

// prisma.user methods
const mockUserFindUnique = jest.fn();
const mockUserFindFirst = jest.fn();
const mockUserCreate = jest.fn();
const mockUserUpdate = jest.fn();

// bcrypt.hash
const mockHash = jest.fn();

// registration validator
const mockValidateRegistrationInput = jest.fn();

// canonical registration router
const mockAuthRouter = jest.fn();

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
      findFirst: mockUserFindFirst,
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

// canonical registration router used by POST /users
jest.unstable_mockModule('../routes/auth.js', () => ({
  default: (req, res, next) => mockAuthRouter(req, res, next),
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
  mockUserFindFirst.mockReset();
  mockUserCreate.mockReset();
  mockUserUpdate.mockReset();
  mockHash.mockReset();
  mockValidateRegistrationInput.mockReset();
  mockAuthRouter.mockReset();
});

// --- Tests: POST /users ------------------------------------------------------

describe('PATCH /users/me disappearing-message preference', () => {
  it.each([0, 1, 10, 60, 86400, 604800, 2592000])('saves and acknowledges %i seconds for only the authenticated account', async (seconds) => {
    mockUserUpdate.mockImplementationOnce(async ({ where, data, select }) => {
      expect(where).toEqual({ id: 123 });
      expect(data).toEqual({ autoDeleteSeconds: seconds });
      expect(select.autoDeleteSeconds).toBe(true);
      return { id: 123, autoDeleteSeconds: data.autoDeleteSeconds };
    });
    const res = await request(createApp({ user: { id: 123 } }))
      .patch('/users/me').send({ autoDeleteSeconds: seconds, id: 999, userId: 999 });
    expect(res.statusCode).toBe(200);
    expect(res.body.autoDeleteSeconds).toBe(seconds);
  });

  it('accepts legacy null as OFF', async () => {
    mockUserUpdate.mockResolvedValueOnce({ id: 123, autoDeleteSeconds: 0 });
    const res = await request(createApp({ user: { id: 123 } }))
      .patch('/users/me').send({ autoDeleteSeconds: null });
    expect(res.statusCode).toBe(200);
    expect(mockUserUpdate.mock.calls[0][0].data).toEqual({ autoDeleteSeconds: 0 });
    expect(res.body.autoDeleteSeconds).toBe(0);
  });

  it.each([-1, 1.5, '10', '', true, false, {}, [], 2147483648])('rejects invalid timer %j without saving other settings', async (value) => {
    const res = await request(createApp({ user: { id: 123 } }))
      .patch('/users/me').send({ autoDeleteSeconds: value, showReadReceipts: false });
    expect(res.statusCode).toBe(400);
    expect(res.body.error).toBe('Invalid autoDeleteSeconds');
    expect(mockUserUpdate).not.toHaveBeenCalled();
  });

  it('preserves an enabled timer when saving an unrelated setting', async () => {
    mockUserUpdate.mockImplementationOnce(async ({ data, select }) => {
      expect(data).toEqual({ showReadReceipts: false });
      expect(select.autoDeleteSeconds).toBe(true);
      return { id: 123, autoDeleteSeconds: 10, showReadReceipts: false };
    });
    const res = await request(createApp({ user: { id: 123 } }))
      .patch('/users/me').send({ showReadReceipts: false });
    expect(res.statusCode).toBe(200);
    expect(res.body.autoDeleteSeconds).toBe(10);
  });

  it('does not report success after a database failure', async () => {
    mockUserUpdate.mockRejectedValueOnce(new Error('controlled failure'));
    const res = await request(createApp({ user: { id: 123 } }))
      .patch('/users/me').send({ autoDeleteSeconds: 10 });
    expect(res.statusCode).toBe(500);
  });
});

describe('POST /users', () => {
  it('delegates to canonical /auth/register and preserves legacy success shape', async () => {
    let delegatedUrl = null;

    mockAuthRouter.mockImplementationOnce((req, res) => {
      delegatedUrl = req.url;

      return res.status(201).json({
        user: {
          id: 42,
          username: 'alice',
          email: 'alice@example.com',
          role: 'USER',
        },
      });
    });

    const app = createApp();

    const res = await request(app)
      .post('/users')
      .send({
        username: 'alice',
        email: 'alice@example.com',
        password: 'ValidPass123!',
      });

    expect(res.statusCode).toBe(201);
    expect(delegatedUrl).toBe('/register');
    expect(mockAuthRouter).toHaveBeenCalledTimes(1);

    expect(res.body).toEqual({
      id: 42,
      username: 'alice',
      email: 'alice@example.com',
      role: 'USER',
      requiresEmailVerification: true,
    });
  });

  it('passes canonical registration errors through unchanged', async () => {
    let delegatedUrl = null;

    const canonicalError = {
      message: 'Invalid registration data',
      details: [
        {
          path: ['email'],
          message: 'Invalid email',
        },
      ],
    };

    mockAuthRouter.mockImplementationOnce((req, res) => {
      delegatedUrl = req.url;
      return res.status(422).json(canonicalError);
    });

    const app = createApp();

    const res = await request(app)
      .post('/users')
      .send({
        username: 'test',
        email: 'bad-email',
        password: 'ValidPass123!',
      });

    expect(res.statusCode).toBe(422);
    expect(delegatedUrl).toBe('/register');
    expect(mockAuthRouter).toHaveBeenCalledTimes(1);
    expect(res.body).toEqual(canonicalError);
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
    expect(res.body).toMatchObject({
      id: 123,
      role: 'USER',
      plan: 'FREE',
      publicKey: null,
      theme: 'dawn',
      isPremium: false,

      enableSmartReplies: true,
      showReadReceipts: false,
      allowExplicitContent: true,
      privacyBlurEnabled: true,
      privacyBlurOnUnfocus: false,
      privacyHoldToReveal: true,
      notifyOnCopy: false,
      preferredLanguage: 'en-US',
    });

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

    // theme check queries the user's active entitlement via prisma
    mockUserFindUnique.mockResolvedValueOnce({
      plan: 'FREE',
      role: 'USER',
      subscriptionStatus: 'INACTIVE',
      subscriptionEndsAt: null,
    });

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
      select: {
        plan: true,
        role: true,
        subscriptionStatus: true,
        subscriptionEndsAt: true,
      },
    });
    expect(mockUserUpdate).not.toHaveBeenCalled();
  });

  it.each(['PLUS', 'WIRELESS'])(
    'returns 402 when premium theme is requested on %s plan',
    async (plan) => {
      const user = { id: 123, plan };

      mockUserFindUnique.mockResolvedValueOnce({
        plan,
        role: 'USER',
        subscriptionStatus: 'ACTIVE',
        subscriptionEndsAt: null,
      });

      const app = createApp({ user });

      const res = await request(app)
        .patch('/users/me')
        .send({ theme: 'amoled' });

      expect(res.statusCode).toBe(402);
      expect(res.body).toEqual({
        error: 'Premium theme requires an upgraded plan',
      });

      expect(mockUserUpdate).not.toHaveBeenCalled();
    }
  );

  it.each(['PLUS', 'WIRELESS'])(
    'returns 402 when premium message tone is requested on %s plan',
    async (plan) => {
      const user = { id: 123, plan };

      mockUserFindUnique.mockResolvedValueOnce({
        plan,
        role: 'USER',
        subscriptionStatus: 'ACTIVE',
        subscriptionEndsAt: null,
      });

      const app = createApp({ user });

      const res = await request(app)
        .patch('/users/me')
        .send({ messageTone: 'Dreamer.mp3' });

      expect(res.statusCode).toBe(402);
      expect(res.body).toEqual({
        error: 'Premium message tone requires upgrade',
      });

      expect(mockUserUpdate).not.toHaveBeenCalled();
    }
  );

  it.each(['PLUS', 'WIRELESS'])(
    'returns 402 when premium ringtone is requested on %s plan',
    async (plan) => {
      const user = { id: 123, plan };

      mockUserFindUnique.mockResolvedValueOnce({
        plan,
        role: 'USER',
        subscriptionStatus: 'ACTIVE',
        subscriptionEndsAt: null,
      });

      const app = createApp({ user });

      const res = await request(app)
        .patch('/users/me')
        .send({ ringtone: 'Bells.mp3' });

      expect(res.statusCode).toBe(402);
      expect(res.body).toEqual({
        error: 'Premium ringtone requires upgrade',
      });

      expect(mockUserUpdate).not.toHaveBeenCalled();
    }
  );

  it('returns 402 when PREMIUM subscription is inactive', async () => {
    const user = { id: 201, plan: 'PREMIUM' };

    mockUserFindUnique.mockResolvedValueOnce({
      plan: 'PREMIUM',
      role: 'USER',
      subscriptionStatus: 'INACTIVE',
      subscriptionEndsAt: null,
    });

    const app = createApp({ user });

    const res = await request(app)
      .patch('/users/me')
      .send({ theme: 'amoled' });

    expect(res.statusCode).toBe(402);
    expect(mockUserUpdate).not.toHaveBeenCalled();
  });

  it('returns 402 when PREMIUM subscription is expired', async () => {
    const user = { id: 202, plan: 'PREMIUM' };

    mockUserFindUnique.mockResolvedValueOnce({
      plan: 'PREMIUM',
      role: 'USER',
      subscriptionStatus: 'ACTIVE',
      subscriptionEndsAt: new Date(Date.now() - 60_000),
    });

    const app = createApp({ user });

    const res = await request(app)
      .patch('/users/me')
      .send({ theme: 'amoled' });

    expect(res.statusCode).toBe(402);
    expect(mockUserUpdate).not.toHaveBeenCalled();
  });

  it('allows premium theme when PREMIUM subscription is TRIALING', async () => {
    const user = { id: 203, plan: 'PREMIUM' };

    mockUserFindUnique.mockResolvedValueOnce({
      plan: 'PREMIUM',
      role: 'USER',
      subscriptionStatus: 'TRIALING',
      subscriptionEndsAt: new Date(Date.now() + 60_000),
    });

    mockUserUpdate.mockResolvedValueOnce({
      id: 203,
      username: 'trialuser',
      email: 'trial@example.com',
      role: 'USER',
      plan: 'PREMIUM',
      subscriptionStatus: 'TRIALING',
      subscriptionEndsAt: new Date(Date.now() + 60_000),
      publicKey: null,
      theme: 'amoled',
    });

    const app = createApp({ user });

    const res = await request(app)
      .patch('/users/me')
      .send({ theme: 'amoled' });

    expect(res.statusCode).toBe(200);
    expect(res.body.theme).toBe('amoled');
  });

  it('allows premium theme when user has PREMIUM plan', async () => {
    const user = { id: 200, plan: 'PREMIUM' };

    mockUserFindUnique.mockResolvedValueOnce({
      plan: 'PREMIUM',
      role: 'USER',
      subscriptionStatus: 'ACTIVE',
      subscriptionEndsAt: new Date(Date.now() + 60_000),
    });

    const updated = {
      id: 200,
      username: 'testuser',
      email: 'test@example.com',
      role: 'USER',
      plan: 'PREMIUM',
      subscriptionStatus: 'ACTIVE',
      subscriptionEndsAt: new Date(Date.now() + 60_000),
      publicKey: null,
      theme: 'amoled',
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

describe('PATCH /users/me independent voicemail email forwarding', () => {
  const app = () => createApp({ user: { id: 65, plan: 'PREMIUM' } });

  it.each(['PLUS', 'PREMIUM'])('enables forwarding for a database %s plan without changing voicemail availability', async (plan) => {
    mockUserFindUnique.mockResolvedValue({ plan, voicemailForwardEmail: 'saved@example.com' });
    mockUserUpdate.mockResolvedValue({ id: 65, plan, voicemailEnabled: false, voicemailForwardEmail: 'saved@example.com', voicemailEmailForwardingEnabled: true });
    const res = await request(app()).patch('/users/me').send({ voicemailEmailForwardingEnabled: true });
    expect(res.status).toBe(200);
    expect(mockUserUpdate.mock.calls[0][0].data).toEqual({ voicemailEmailForwardingEnabled: true });
    expect(res.body).toMatchObject({ voicemailEnabled: false, canForwardVoicemailEmail: true, voicemailEmailForwardingEnabled: true });
  });

  it('rejects Free entitlement even when the request token says Premium', async () => {
    mockUserFindUnique.mockResolvedValue({ plan: 'FREE', voicemailForwardEmail: 'saved@example.com' });
    const res = await request(app()).patch('/users/me').send({ voicemailEmailForwardingEnabled: true });
    expect(res.status).toBe(402);
    expect(mockUserUpdate).not.toHaveBeenCalled();
  });

  it('turns forwarding off without clearing the saved email or touching voicemail availability', async () => {
    mockUserUpdate.mockResolvedValue({ id: 65, plan: 'FREE', voicemailEnabled: true, voicemailForwardEmail: 'saved@example.com', voicemailEmailForwardingEnabled: false });
    const res = await request(app()).patch('/users/me').send({ voicemailEmailForwardingEnabled: false });
    expect(res.status).toBe(200);
    expect(mockUserUpdate.mock.calls[0][0].data).toEqual({ voicemailEmailForwardingEnabled: false });
    expect(res.body.voicemailForwardEmail).toBe('saved@example.com');
    expect(mockUserFindUnique).not.toHaveBeenCalled();
  });

  it('legacy address-only saves never implicitly enable forwarding', async () => {
    mockUserUpdate.mockResolvedValue({ id: 65, plan: 'PLUS', voicemailEmailForwardingEnabled: false });
    await request(app()).patch('/users/me').send({ voicemailForwardEmail: 'voice@example.com' }).expect(200);
    expect(mockUserUpdate.mock.calls[0][0].data).toEqual({ voicemailForwardEmail: 'voice@example.com' });
  });

  it('clearing an address safely disables forwarding for legacy clients', async () => {
    mockUserUpdate.mockResolvedValue({ id: 65, plan: 'PLUS' });
    await request(app()).patch('/users/me').send({ voicemailForwardEmail: '' }).expect(200);
    expect(mockUserUpdate.mock.calls[0][0].data).toEqual({ voicemailForwardEmail: null, voicemailEmailForwardingEnabled: false });
  });

  it('rejects enabling without an email without writing any settings', async () => {
    mockUserFindUnique.mockResolvedValue({ plan: 'PLUS', voicemailForwardEmail: null });
    await request(app()).patch('/users/me').send({ voicemailEmailForwardingEnabled: true, voicemailGreetingText: 'Hello' }).expect(400);
    expect(mockUserUpdate).not.toHaveBeenCalled();
  });

  it('leaves both preferences alone when saving other settings', async () => {
    mockUserUpdate.mockResolvedValue({ id: 65, plan: 'PLUS' });
    await request(app()).patch('/users/me').send({ voicemailGreetingText: 'Hello' }).expect(200);
    expect(mockUserUpdate.mock.calls[0][0].data).toEqual({ voicemailGreetingText: 'Hello' });
  });
});
