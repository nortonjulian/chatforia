import express from 'express';
import request from 'supertest';

// ---- mocks ----

// Auth: just attach a fake user and continue
jest.mock('../middleware/auth.js', () => ({
  requireAuth: (req, res, next) => {
    req.user = { id: 42 };
    next();
  },
}));

const mockNormalizeE164 = jest.fn((n) => `+${String(n)}`);
const mockIsE164 = jest.fn(() => true);
jest.mock('../utils/phone.js', () => ({
  normalizeE164: jest.fn((n) => `+${String(n)}`),
  isE164: jest.fn(() => true),
}));

const mockCallsCreate = jest.fn();
const mockTwilio = jest.fn(() => ({
  calls: {
    create: mockCallsCreate,
  },
}));

jest.mock('twilio', () => ({
  __esModule: true,
  default: mockTwilio,
}));

import router from '../routes/voiceCalls.js';
import { normalizeE164, isE164 } from '../utils/phone.js';
import twilio from 'twilio';

// small helper to build an app with JSON body parsing
function makeApp() {
  const app = express();
  app.use(express.json());
  app.use('/calls', router);
  return app;
}

describe('POST /calls/pstn', () => {
  let app;
  const OLD_ENV = process.env;

  beforeEach(() => {
    app = makeApp();
    jest.clearAllMocks();

    process.env = { ...OLD_ENV };
    process.env.TWILIO_ACCOUNT_SID = 'AC123';
    process.env.TWILIO_AUTH_TOKEN = 'secret';
    process.env.TWILIO_FROM_NUMBER = '+15550000000';
    process.env.PUBLIC_BASE_URL = 'https://chatforia.test';

    mockIsE164.mockReturnValue(true);
    mockCallsCreate.mockResolvedValue({ sid: 'CA1234567890' });
  });

  afterAll(() => {
    process.env = OLD_ENV;
  });

  it('starts a PSTN call via Twilio and returns callSid', async () => {
    const res = await request(app)
      .post('/calls/pstn')
      .send({ to: '5551234567' })
      .expect(200);

    // phone helpers
    expect(normalizeE164).toHaveBeenCalledWith('5551234567');
    expect(isE164).toHaveBeenCalled();

    // Twilio client
    expect(twilio).toHaveBeenCalledWith('AC123', 'secret');
    expect(mockCallsCreate).toHaveBeenCalledTimes(1);

    const args = mockCallsCreate.mock.calls[0][0];

    // outbound call payload
    expect(args.to).toBe('+5551234567');
    expect(args.from).toBe('+15550000000');

    expect(args.url).toContain(
      'https://chatforia.test/webhooks/voice/alias/legA'
    );
    expect(args.url).toContain('userId=42');
    expect(args.url).toContain('from=%2B15550000000');
    expect(args.url).toContain('to=%2B5551234567');

    expect(args.statusCallback).toBe(
      'https://chatforia.test/webhooks/voice/status'
    );
    expect(args.statusCallbackEvent).toEqual([
      'initiated',
      'ringing',
      'answered',
      'completed',
    ]);

    expect(res.body).toEqual({ success: true, callSid: 'CA1234567890' });
  });

  it('returns 400 for an invalid phone number', async () => {
    mockIsE164.mockReturnValue(false);

    const res = await request(app)
      .post('/calls/pstn')
      .send({ to: 'not-a-number' })
      .expect(400);

    expect(res.body).toEqual({ error: 'Invalid phone number' });
    expect(mockCallsCreate).not.toHaveBeenCalled();
  });

  it('returns 500 when Twilio Voice is not configured', async () => {
    delete process.env.TWILIO_FROM_NUMBER; // missing config

    const res = await request(app)
      .post('/calls/pstn')
      .send({ to: '5551234567' })
      .expect(500);

    expect(res.body).toEqual({ error: 'Twilio Voice not configured' });
    expect(mockTwilio).not.toHaveBeenCalled();
    expect(mockCallsCreate).not.toHaveBeenCalled();
  });

  it('returns 500 when Twilio call creation throws', async () => {
    mockCallsCreate.mockRejectedValueOnce(new Error('twilio failure'));

    const res = await request(app)
      .post('/calls/pstn')
      .send({ to: '5551234567' })
      .expect(500);

    expect(res.body).toEqual({ error: 'Failed to start call' });
    expect(mockCallsCreate).toHaveBeenCalledTimes(1);
  });
});
