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

process.env = {
  ...process.env,
  TWILIO_ACCOUNT_SID: 'AC_TEST_SID',
  TWILIO_API_KEY_SID: 'SK_TEST_SID',
  TWILIO_API_KEY_SECRET: 'TEST_SECRET',
};

const prismaMock = {
  call: {
    findFirst: jest.fn(),
  },
};

const availabilityMock = jest.fn();

await jest.unstable_mockModule('../middleware/auth.js', () => ({
  requireAuth: (req, _res, next) => {
    req.user = {
      id: 42,
      username: 'julian',
    };
    next();
  },
}));

await jest.unstable_mockModule('../utils/prismaClient.js', () => ({
  __esModule: true,
  default: prismaMock,
}));

await jest.unstable_mockModule('../services/callUsageService.js', () => ({
  getUsageAvailability: availabilityMock,
}));

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

const { default: videoTokensRouter } = await import('../routes/videoTokens.js');

const app = express();
app.use(express.json());
app.use(videoTokensRouter);

beforeEach(() => {
  jest.clearAllMocks();
  lastAccessTokenInstance = undefined;

  prismaMock.call.findFirst.mockResolvedValue({
    id: 91,
    callerId: 42,
    calleeId: 99,
    externalPhone: null,
    status: 'RINGING',
  });

  availabilityMock.mockResolvedValue({
    meter: 'hostedParticipantSeconds',
    used: 30,
    limit: 18000,
    remaining: 17970,
  });
});

afterAll(() => {
  process.env = ORIGINAL_ENV;
});

describe('POST /video/token', () => {
  test('400 when room is missing', async () => {
    const res = await request(app)
      .post('/video/token')
      .send({ identity: 'attacker-controlled' });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'room is required' });
    expect(lastAccessTokenInstance).toBeUndefined();
  });

  test('400 for arbitrary non-call room names', async () => {
    const res = await request(app)
      .post('/video/token')
      .send({ room: 'chatforia-room-1' });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'invalid_video_room' });
    expect(prismaMock.call.findFirst).not.toHaveBeenCalled();
  });

  test('403 when authenticated user is not authorized for the call', async () => {
    prismaMock.call.findFirst.mockResolvedValueOnce(null);

    const res = await request(app)
      .post('/video/token')
      .send({ room: 'call_91' });

    expect(res.status).toBe(403);
    expect(res.body).toEqual({ error: 'video_room_forbidden' });
    expect(lastAccessTokenInstance).toBeUndefined();
  });

  test('429 when hosted participant allowance is exhausted', async () => {
    availabilityMock.mockResolvedValueOnce({
      meter: 'hostedParticipantSeconds',
      used: 18000,
      limit: 18000,
      remaining: 0,
    });

    const res = await request(app)
      .post('/video/token')
      .send({ room: 'call_91' });

    expect(res.status).toBe(429);
    expect(res.body).toEqual({
      error: 'Hosted call allowance exhausted',
      code: 'PLAN_ALLOWANCE_EXCEEDED',
      detail: 'hostedParticipantSeconds',
      limit: 18000,
      used: 18000,
      remaining: 0,
    });

    expect(lastAccessTokenInstance).toBeUndefined();
  });

  test('ignores client identity and issues token using authenticated user', async () => {
    const res = await request(app)
      .post('/video/token')
      .send({
        identity: 'someone-else',
        room: 'call_91',
      });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      token: 'mock.jwt.token',
      room: 'call_91',
      identity: 'user-42',
      remainingHostedSeconds: 17970,
    });

    expect(prismaMock.call.findFirst).toHaveBeenCalledWith({
      where: {
        id: 91,
        OR: [
          { callerId: 42 },
          { calleeId: 42 },
          {
            participants: {
              some: {
                userId: 42,
              },
            },
          },
        ],
      },
      select: {
        id: true,
        callerId: true,
        calleeId: true,
        externalPhone: true,
        status: true,
      },
    });

    expect(availabilityMock).toHaveBeenCalledWith({
      userId: 42,
      meter: 'hostedParticipantSeconds',
    });

    expect(lastAccessTokenInstance).toBeInstanceOf(AccessTokenCtor);
    expect(lastAccessTokenInstance.args).toEqual({
      accountSid: 'AC_TEST_SID',
      apiKeySid: 'SK_TEST_SID',
      apiKeySecret: 'TEST_SECRET',
      options: {
        identity: 'user-42',
        ttl: 60 * 60,
      },
    });

    expect(lastAccessTokenInstance.addGrant).toHaveBeenCalledTimes(1);

    const [grantArg] = lastAccessTokenInstance.addGrant.mock.calls[0];
    expect(grantArg).toBeInstanceOf(VideoGrantCtor);
    expect(grantArg.opts).toEqual({
      room: 'call_91',
    });
  });
});
