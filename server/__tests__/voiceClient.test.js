import request from 'supertest';
import express from 'express';
import { jest } from '@jest/globals';

jest.mock('../middleware/auth.js', () => ({
  __esModule: true,
  requireAuth: (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    return next();
  },
}));

jest.mock('twilio', () => {
  class MockVoiceGrant {
    constructor(opts) {
      this.opts = opts;
    }
  }

  class MockAccessToken {
    constructor(accountSid, apiKeySid, apiKeySecret, opts) {
      this.accountSid = accountSid;
      this.apiKeySid = apiKeySid;
      this.apiKeySecret = apiKeySecret;
      this.opts = opts;
      this.identity = null;
      this.grants = [];
    }

    addGrant(grant) {
      this.grants.push(grant);
    }

    toJwt() {
      return `mock-jwt-for-${this.identity}`;
    }
  }

  MockAccessToken.VoiceGrant = MockVoiceGrant;

  return {
    __esModule: true,
    default: {
      jwt: {
        AccessToken: MockAccessToken,
      },
    },
  };
});

const { default: voiceClientRouter } = await import('../routes/voiceClient.js');

describe('POST /voice/token', () => {
  const OLD_ENV = process.env;

  beforeEach(() => {
    process.env = { ...OLD_ENV };
  });

  afterAll(() => {
    process.env = OLD_ENV;
  });

  function buildAppWithUser(user = { id: 123 }) {
    const app = express();

    app.use(express.json());

    app.use((req, _res, next) => {
      req.user = user;
      next();
    });

    app.use('/voice', voiceClientRouter);

    return app;
  }

  function buildAppWithoutUser() {
    const app = express();

    app.use(express.json());
    app.use('/voice', voiceClientRouter);

    return app;
  }

  test('returns 500 when required Twilio env vars are missing', async () => {
    const app = buildAppWithUser();

    delete process.env.TWILIO_ACCOUNT_SID;
    delete process.env.TWILIO_API_KEY_SID;
    delete process.env.TWILIO_API_KEY_SECRET;
    delete process.env.TWILIO_VOICE_TWIML_APP_SID;

    const res = await request(app).post('/voice/token');

    expect(res.status).toBe(500);
    expect(res.body).toHaveProperty('error');
    expect(res.body.error).toMatch(/Twilio Voice token not configured/i);
  });

  test('returns 401 when user is not present on req', async () => {
    const app = buildAppWithoutUser();

    process.env.TWILIO_ACCOUNT_SID = 'AC_test_sid';
    process.env.TWILIO_API_KEY_SID = 'SK_test_key';
    process.env.TWILIO_API_KEY_SECRET = 'supersecret';
    process.env.TWILIO_VOICE_TWIML_APP_SID = 'AP_test_app';

    const res = await request(app).post('/voice/token');

    expect(res.status).toBe(401);
    expect(res.body).toHaveProperty('error');
    expect(res.body.error).toMatch(/unauthorized/i);
  });

  test('returns 200 and a Twilio Access Token when env vars and user are present', async () => {
    const app = buildAppWithUser({ id: 42 });

    process.env.TWILIO_ACCOUNT_SID = 'AC_test_sid';
    process.env.TWILIO_API_KEY_SID = 'SK_test_key';
    process.env.TWILIO_API_KEY_SECRET = 'supersecret';
    process.env.TWILIO_VOICE_TWIML_APP_SID = 'AP_test_app';

    const res = await request(app).post('/voice/token');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      token: 'mock-jwt-for-user:42',
      identity: 'user:42',
      ttlSeconds: 60 * 60,
    });
  });
});