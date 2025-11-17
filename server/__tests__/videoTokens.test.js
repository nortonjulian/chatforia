import {
  jest,
  describe,
  test,
  expect,
  beforeEach,
  afterAll,
} from '@jest/globals';
import request from 'supertest';
import express from 'express';

const ORIGINAL_ENV = process.env;

// Set Twilio env vars BEFORE importing the router (they’re read at module load)
process.env = {
  ...process.env,
  TWILIO_ACCOUNT_SID: 'AC_TEST_SID',
  TWILIO_API_KEY_SID: 'SK_TEST_SID',
  TWILIO_API_KEY_SECRET: 'TEST_SECRET',
};

// ---- Twilio mock wiring ----
let AccessTokenCtor;
let VideoGrantCtor;
let lastAccessTokenInstance;

await jest.unstable_mockModule('twilio', () => {
  class MockVideoGrant {
    constructor(opts) {
      this.opts = opts;
    }
  }
  VideoGrantCtor = MockVideoGrant;

  class MockAccessToken {
    constructor(accountSid, apiKeySid, apiKeySecret, options) {
      this.args = { accountSid, apiKeySid, apiKeySecret, options };
      this.identity = undefined;
      this._grants = [];
      this.addGrant = jest.fn((grant) => {
        this._grants.push(grant);
      });
      this.toJwt = jest.fn(() => 'mock.jwt.token');
      lastAccessTokenInstance = this;
    }
  }
  MockAccessToken.VideoGrant = MockVideoGrant;
  AccessTokenCtor = MockAccessToken;

  return {
    __esModule: true,
    default: {
      jwt: {
        AccessToken: MockAccessToken,
      },
    },
  };
});

// Import the router AFTER mocks are registered (and env is set)
const { default: videoTokensRouter } = await import('../routes/videoTokens.js');

// Build test app
const app = express();
app.use(videoTokensRouter);

beforeEach(() => {
  jest.clearAllMocks();
  lastAccessTokenInstance = undefined;
});

afterAll(() => {
  process.env = ORIGINAL_ENV;
});

// ----------------------------- Tests ---------------------------------------
describe('POST /video/token', () => {
  test('400 when identity or room missing', async () => {
    // missing both
    let res = await request(app)
      .post('/video/token')
      .send({});

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'identity and room are required' });
    expect(lastAccessTokenInstance).toBeUndefined();

    // missing room only
    res = await request(app)
      .post('/video/token')
      .send({ identity: 'user-1' });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'identity and room are required' });
    expect(lastAccessTokenInstance).toBeUndefined();
  });

  test('issues video token with correct args and payload', async () => {
    const res = await request(app)
      .post('/video/token')
      .send({ identity: 'julian', room: 'chatforia-room-1' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ token: 'mock.jwt.token' });

    // AccessToken instance created
    expect(lastAccessTokenInstance).toBeInstanceOf(AccessTokenCtor);

    // Constructor arguments use env + ttl 1h
    expect(lastAccessTokenInstance.args).toEqual({
      accountSid: 'AC_TEST_SID',
      apiKeySid: 'SK_TEST_SID',
      apiKeySecret: 'TEST_SECRET',
      options: { ttl: 60 * 60 },
    });

    // identity set as string
    expect(lastAccessTokenInstance.identity).toBe('julian');

    // addGrant called with a VideoGrant containing the room
    expect(lastAccessTokenInstance.addGrant).toHaveBeenCalledTimes(1);
    const [grantArg] = lastAccessTokenInstance.addGrant.mock.calls[0];
    expect(grantArg).toBeInstanceOf(VideoGrantCtor);
    expect(grantArg.opts).toEqual({ room: 'chatforia-room-1' });

    // toJwt used to produce the response token
    expect(lastAccessTokenInstance.toJwt).toHaveBeenCalledTimes(1);
  });
});
