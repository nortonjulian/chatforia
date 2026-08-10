import request from 'supertest';
import express from 'express';
import { jest } from '@jest/globals';

const prismaDeviceFindUnique = jest.fn();

await jest.unstable_mockModule('../middleware/auth.js', () => ({
  __esModule: true,
  requireAuth: (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    return next();
  },
}));

await jest.unstable_mockModule('../utils/prismaClient.js', () => ({
  __esModule: true,
  default: {
    device: {
      findUnique: prismaDeviceFindUnique,
    },
  },
}));

await jest.unstable_mockModule('twilio', () => {
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
      this.identity = opts?.identity ?? null;
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
    prismaDeviceFindUnique.mockReset();
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

  test('keeps legacy user identity when mobile client omits deviceId', async () => {
  const app = buildAppWithUser({ id: 42 });

  process.env.TWILIO_ACCOUNT_SID = 'AC_test_sid';
  process.env.TWILIO_API_KEY_SID = 'SK_test_key';
  process.env.TWILIO_API_KEY_SECRET = 'supersecret';
  process.env.TWILIO_VOICE_TWIML_APP_SID = 'AP_test_app';
  process.env.TWILIO_ANDROID_PUSH_CREDENTIAL_SID = 'CR_android_push';

  const res = await request(app)
    .post('/voice/token')
    .send({
      platform: 'android',
    });

  expect(res.status).toBe(200);
  expect(res.body).toEqual({
    token: 'mock-jwt-for-user_42',
    identity: 'user_42',
    ttlSeconds: 60 * 60,
    deviceSpecific: false,
  });

  expect(prismaDeviceFindUnique).not.toHaveBeenCalled();
  });

  test('returns device-specific identity for registered Android device', async () => {
  prismaDeviceFindUnique.mockResolvedValue({
    deviceId: 'android-device-123',
    platform: 'android',
    revokedAt: null,
    pairingStatus: 'approved',
  });

  const app = buildAppWithUser({ id: 42 });

  process.env.TWILIO_ACCOUNT_SID = 'AC_test_sid';
  process.env.TWILIO_API_KEY_SID = 'SK_test_key';
  process.env.TWILIO_API_KEY_SECRET = 'supersecret';
  process.env.TWILIO_VOICE_TWIML_APP_SID = 'AP_test_app';
  process.env.TWILIO_ANDROID_PUSH_CREDENTIAL_SID = 'CR_android_push';

  const res = await request(app)
    .post('/voice/token')
    .send({
      platform: 'android',
      deviceId: 'android-device-123',
    });

  expect(res.status).toBe(200);

  expect(prismaDeviceFindUnique).toHaveBeenCalledWith({
    where: {
      userId_deviceId: {
        userId: 42,
        deviceId: 'android-device-123',
      },
    },
    select: {
      deviceId: true,
      platform: true,
      revokedAt: true,
      pairingStatus: true,
    },
  });

  expect(res.body).toEqual({
    token: 'mock-jwt-for-user_42_device_android_device_123',
    identity: 'user_42_device_android_device_123',
    ttlSeconds: 60 * 60,
    deviceSpecific: true,
  });
  });

  test('returns device-specific identity for registered iOS device', async () => {
  prismaDeviceFindUnique.mockResolvedValue({
    deviceId: 'ios-device-456',
    platform: 'ios',
    revokedAt: null,
    pairingStatus: 'approved',
  });

  const app = buildAppWithUser({ id: 42 });

  process.env.TWILIO_ACCOUNT_SID = 'AC_test_sid';
  process.env.TWILIO_API_KEY_SID = 'SK_test_key';
  process.env.TWILIO_API_KEY_SECRET = 'supersecret';
  process.env.TWILIO_VOICE_TWIML_APP_SID = 'AP_test_app';
  process.env.TWILIO_IOS_PUSH_CREDENTIAL_SID = 'CR_ios_prod_push';

  const res = await request(app)
    .post('/voice/token')
    .send({
      platform: 'ios',
      pushEnvironment: 'production',
      deviceId: 'ios-device-456',
    });

  expect(res.status).toBe(200);

  expect(res.body).toEqual({
    token: 'mock-jwt-for-user_42_device_ios_device_456',
    identity: 'user_42_device_ios_device_456',
    ttlSeconds: 60 * 60,
    deviceSpecific: true,
  });
  });

  test('rejects unknown mobile device', async () => {
  prismaDeviceFindUnique.mockResolvedValue(null);

  const app = buildAppWithUser({ id: 42 });

  process.env.TWILIO_ACCOUNT_SID = 'AC_test_sid';
  process.env.TWILIO_API_KEY_SID = 'SK_test_key';
  process.env.TWILIO_API_KEY_SECRET = 'supersecret';
  process.env.TWILIO_VOICE_TWIML_APP_SID = 'AP_test_app';

  const res = await request(app)
    .post('/voice/token')
    .send({
      platform: 'android',
      deviceId: 'missing-device',
    });

  expect(res.status).toBe(409);
  expect(res.body.code).toBe(
    'DEVICE_REGISTRATION_REQUIRED'
  );
  });

  test('rejects revoked mobile device', async () => {
  prismaDeviceFindUnique.mockResolvedValue({
    deviceId: 'revoked-device',
    platform: 'android',
    revokedAt: new Date('2026-08-01T00:00:00Z'),
    pairingStatus: 'approved',
  });

  const app = buildAppWithUser({ id: 42 });

  process.env.TWILIO_ACCOUNT_SID = 'AC_test_sid';
  process.env.TWILIO_API_KEY_SID = 'SK_test_key';
  process.env.TWILIO_API_KEY_SECRET = 'supersecret';
  process.env.TWILIO_VOICE_TWIML_APP_SID = 'AP_test_app';

  const res = await request(app)
    .post('/voice/token')
    .send({
      platform: 'android',
      deviceId: 'revoked-device',
    });

  expect(res.status).toBe(409);
  expect(res.body.code).toBe('DEVICE_REVOKED');
  });

  test('rejects rejected mobile device', async () => {
  prismaDeviceFindUnique.mockResolvedValue({
    deviceId: 'rejected-device',
    platform: 'ios',
    revokedAt: null,
    pairingStatus: 'rejected',
  });

  const app = buildAppWithUser({ id: 42 });

  process.env.TWILIO_ACCOUNT_SID = 'AC_test_sid';
  process.env.TWILIO_API_KEY_SID = 'SK_test_key';
  process.env.TWILIO_API_KEY_SECRET = 'supersecret';
  process.env.TWILIO_VOICE_TWIML_APP_SID = 'AP_test_app';

  const res = await request(app)
    .post('/voice/token')
    .send({
      platform: 'ios',
      deviceId: 'rejected-device',
    });

  expect(res.status).toBe(409);
  expect(res.body.code).toBe('DEVICE_NOT_APPROVED');
  });
});
