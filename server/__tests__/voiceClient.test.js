import request from 'supertest';
import express from 'express';
import voiceClientRouter from '../routes/voiceClient.js';

describe('POST /voice/token', () => {
  const OLD_ENV = process.env;

  beforeEach(() => {
    // Reset env for each test (but keep other vars)
    process.env = { ...OLD_ENV };
  });

  afterAll(() => {
    process.env = OLD_ENV;
  });

  function buildAppWithUser(user = { id: 123 }) {
    const app = express();
    app.use(express.json());

    // Test-only middleware to simulate an authenticated user
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
    // No req.user middleware here → requireAuth should reject
    app.use('/voice', voiceClientRouter);
    return app;
  }

  test('returns 500 when required Twilio env vars are missing', async () => {
    const app = buildAppWithUser();

    // Ensure Twilio env vars are missing
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

    // Env is valid but user is missing, so we should hit the 401 branch
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
    expect(res.body).toHaveProperty('token');
    expect(typeof res.body.token).toBe('string');

    // Identity is derived from req.user.id
    expect(res.body.identity).toBe('user:42');

    // 1 hour (60 * 60) from the route
    expect(res.body.ttlSeconds).toBe(60 * 60);
  });
});
