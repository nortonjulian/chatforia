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

let twilioMock;
let tokensCreateMock;

// ---- Mocks ----

// express-rate-limit → simple pass-through middleware
await jest.unstable_mockModule('express-rate-limit', () => {
  const rateLimitFn = jest.fn((_opts) => {
    return (req, res, next) => next();
  });

  return {
    __esModule: true,
    default: rateLimitFn,
  };
});

// twilio client
await jest.unstable_mockModule('twilio', () => {
  tokensCreateMock = jest.fn();

  twilioMock = jest.fn((sid, auth) => ({
    _sid: sid,
    _auth: auth,
    tokens: {
      create: tokensCreateMock,
    },
  }));

  return {
    __esModule: true,
    default: twilioMock,
  };
});

// Import router AFTER mocks
const { default: iceRouter } = await import('../routes/ice.js');

// Build test app
const app = express();
app.use('/ice-servers', iceRouter);

beforeEach(() => {
  jest.clearAllMocks();
  process.env = { ...ORIGINAL_ENV };
});

afterAll(() => {
  process.env = ORIGINAL_ENV;
});

// ------------------------------------------------------------------
// GET /ice-servers
// ------------------------------------------------------------------
describe('GET /ice-servers', () => {
  test('returns default Twilio STUN when no env is set', async () => {
    delete process.env.TWILIO_STUN;
    delete process.env.TWILIO_TURN_URL;
    delete process.env.TWILIO_TURN_USER;
    delete process.env.TWILIO_TURN_PASS;

    const res = await request(app).get('/ice-servers');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      iceServers: [
        { urls: 'stun:global.stun.twilio.com:3478' },
      ],
    });
  });

  test('returns STUN + TURN from env when provided', async () => {
    process.env.TWILIO_STUN = 'stun:custom.twilio.com:3478';
    process.env.TWILIO_TURN_URL = 'turn:turn.twilio.com:3478';
    process.env.TWILIO_TURN_USER = 'user123';
    process.env.TWILIO_TURN_PASS = 'secret456';

    const res = await request(app).get('/ice-servers');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      iceServers: [
        { urls: 'stun:custom.twilio.com:3478' },
        {
          urls: 'turn:turn.twilio.com:3478',
          username: 'user123',
          credential: 'secret456',
        },
      ],
    });
  });
});

// ------------------------------------------------------------------
// POST /ice-servers/token
// ------------------------------------------------------------------
describe('POST /ice-servers/token', () => {
  test('returns 500 when Twilio credentials are not configured', async () => {
    delete process.env.TWILIO_ACCOUNT_SID;
    delete process.env.TWILIO_AUTH_TOKEN;

    const res = await request(app).post('/ice-servers/token');

    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: 'Twilio credentials not configured' });
    expect(twilioMock).not.toHaveBeenCalled();
  });

  test('mints dynamic TURN creds via Twilio and returns iceServers', async () => {
    process.env.TWILIO_ACCOUNT_SID = 'AC_TEST';
    process.env.TWILIO_AUTH_TOKEN = 'AUTH_TEST';

    const returnedIce = [
      { urls: 'stun:global.stun.twilio.com:3478' },
      { urls: 'turn:turn.twilio.com:3478', username: 'u', credential: 'p' },
    ];

    tokensCreateMock.mockResolvedValueOnce({ iceServers: returnedIce });

    const res = await request(app).post('/ice-servers/token');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ iceServers: returnedIce });

    expect(twilioMock).toHaveBeenCalledTimes(1);
    expect(twilioMock).toHaveBeenCalledWith('AC_TEST', 'AUTH_TEST');

    expect(tokensCreateMock).toHaveBeenCalledTimes(1);
    expect(tokensCreateMock).toHaveBeenCalledWith();
  });

  test('returns 500 when Twilio client throws', async () => {
    process.env.TWILIO_ACCOUNT_SID = 'AC_TEST';
    process.env.TWILIO_AUTH_TOKEN = 'AUTH_TEST';

    tokensCreateMock.mockRejectedValueOnce(new Error('Twilio down'));

    const res = await request(app).post('/ice-servers/token');

    expect(res.status).toBe(500);
    expect(res.body).toEqual({
      error: 'Failed to fetch ICE servers from Twilio',
    });

    expect(twilioMock).toHaveBeenCalledTimes(1);
    expect(tokensCreateMock).toHaveBeenCalledTimes(1);
  });
});
