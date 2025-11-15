// server/__tests__/voiceWebhooks.test.js
import { jest, describe, it, expect, beforeEach } from '@jest/globals';
import express from 'express';
import request from 'supertest';

// --- Mock twilio.twiml.VoiceResponse ----------------------------------------

// We'll capture actions and serialize them as JSON so we can assert on them.
class MockVoiceResponse {
  constructor() {
    this.actions = [];
  }

  say(opts, text) {
    this.actions.push({ type: 'say', opts, text });
    return this;
  }

  hangup() {
    this.actions.push({ type: 'hangup' });
    return this;
  }

  gather(opts) {
    const gather = { type: 'gather', opts, says: [] };
    this.actions.push(gather);
    return {
      say: (sOpts, sText) => {
        gather.says.push({ opts: sOpts, text: sText });
        return this;
      },
    };
  }

  dial(opts) {
    const dial = { type: 'dial', opts, numbers: [] };
    this.actions.push(dial);
    return {
      number: (nOpts, to) => {
        dial.numbers.push({ opts: nOpts, to });
        return this;
      },
    };
  }

  toString() {
    // respondWithTwiML calls .toString(); we return JSON for easy assertions
    return JSON.stringify(this.actions);
  }
}

jest.unstable_mockModule('twilio', () => ({
  __esModule: true,
  default: {
    twiml: {
      VoiceResponse: MockVoiceResponse,
    },
  },
}));

// --- Mock phone utils --------------------------------------------------------

// normalizeE164: just stringify
// isE164: very simple +digits check
jest.unstable_mockModule('../utils/phone.js', () => ({
  __esModule: true,
  normalizeE164: (v) => String(v || ''),
  isE164: (v) => /^\+\d{6,}$/.test(String(v || '')),
}));

// --- Mock express-rate-limit -------------------------------------------------

// Make rateLimit a no-op middleware
jest.unstable_mockModule('express-rate-limit', () => ({
  __esModule: true,
  default: () => (req, res, next) => next(),
}));

// Import router AFTER mocks
const { default: voiceRouter } = await import('../routes/voiceWebhooks.js');

// --- Helper: build app -------------------------------------------------------

function createApp() {
  const app = express();
  // NOTE: router itself uses express.urlencoded, so we don't need it here.
  app.use('/webhooks/voice', voiceRouter);
  return app;
}

beforeEach(() => {
  jest.clearAllMocks();
});

// --- Tests: /alias/legA ------------------------------------------------------

describe('POST /webhooks/voice/alias/legA', () => {
  it('responds with validation error TwiML when params are missing/invalid', async () => {
    const app = createApp();

    const res = await request(app)
      .post('/webhooks/voice/alias/legA')
      .type('form') // Twilio sends x-www-form-urlencoded
      .send({});    // no query params -> invalid

    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/xml/);

    const actions = JSON.parse(res.text);

    // We expect: say "We could not validate this call. Goodbye." then hangup
    expect(actions[0]).toEqual({
      type: 'say',
      opts: { voice: 'alice' },
      text: 'We could not validate this call. Goodbye.',
    });
    expect(actions[1]).toEqual({ type: 'hangup' });
  });

  it('gathers DTMF and builds confirm action URL when params are valid', async () => {
    const app = createApp();

    const userId = '123';
    const from = '+15550001111';
    const to = '+15550009999';

    const res = await request(app)
      .post(
        `/webhooks/voice/alias/legA?userId=${userId}&from=${encodeURIComponent(
          from
        )}&to=${encodeURIComponent(to)}`
      )
      .type('form')
      .send({}); // Twilio still sends a body but we don't care here

    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/xml/);

    const actions = JSON.parse(res.text);

    // actions[0] should be the gather
    const gather = actions[0];
    expect(gather.type).toBe('gather');
    expect(gather.opts.input).toBe('dtmf');
    expect(gather.opts.numDigits).toBe(1);
    expect(gather.opts.method).toBe('POST');
    expect(gather.opts.timeout).toBe(6);

    // Parse action URL and assert path + params (host/port can vary)
    const url = new URL(gather.opts.action);
    expect(url.pathname).toBe('/webhooks/voice/alias/confirm');
    expect(url.searchParams.get('userId')).toBe(userId);
    expect(url.searchParams.get('from')).toBe(from);
    expect(url.searchParams.get('to')).toBe(to);

    // gather.say text
    expect(gather.says).toHaveLength(1);
    expect(gather.says[0]).toEqual({
      opts: { voice: 'alice' },
      text: 'Chatforia. Press 1 to connect your call.',
    });

    // After gather, we should have "No input received. Goodbye." and hangup
    expect(actions[1]).toEqual({
      type: 'say',
      opts: { voice: 'alice' },
      text: 'No input received. Goodbye.',
    });
    expect(actions[2]).toEqual({ type: 'hangup' });
  });
});

// --- Tests: /alias/confirm ---------------------------------------------------

describe('POST /webhooks/voice/alias/confirm', () => {
  it('responds with validation error TwiML when params are invalid', async () => {
    const app = createApp();

    const res = await request(app)
      .post('/webhooks/voice/alias/confirm') // no query params
      .type('form')
      .send({ Digits: '1' });

    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/xml/);

    const actions = JSON.parse(res.text);

    expect(actions[0]).toEqual({
      type: 'say',
      opts: { voice: 'alice' },
      text: 'We could not validate this call. Goodbye.',
    });
    expect(actions[1]).toEqual({ type: 'hangup' });
  });

  it('dials destination when Digits === "1"', async () => {
    const app = createApp();

    const userId = '456';
    const from = '+15550002222';
    const to = '+15550003333';

    const res = await request(app)
      .post(
        `/webhooks/voice/alias/confirm?userId=${userId}&from=${encodeURIComponent(
          from
        )}&to=${encodeURIComponent(to)}`
      )
      .type('form')
      .send({ Digits: '1' });

    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/xml/);

    const actions = JSON.parse(res.text);

    // Say "Connecting."
    expect(actions[0]).toEqual({
      type: 'say',
      opts: { voice: 'alice' },
      text: 'Connecting.',
    });

    // Then Dial
    const dial = actions[1];
    expect(dial.type).toBe('dial');
    expect(dial.opts).toEqual({ callerId: from });
    expect(dial.numbers).toHaveLength(1);
    expect(dial.numbers[0]).toEqual({
      opts: {},
      to,
    });
  });

  it('says Cancelled and hangs up when Digits !== "1"', async () => {
    const app = createApp();

    const userId = '789';
    const from = '+15550004444';
    const to = '+15550005555';

    const res = await request(app)
      .post(
        `/webhooks/voice/alias/confirm?userId=${userId}&from=${encodeURIComponent(
          from
        )}&to=${encodeURIComponent(to)}`
      )
      .type('form')
      .send({ Digits: '3' });

    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/xml/);

    const actions = JSON.parse(res.text);

    expect(actions[0]).toEqual({
      type: 'say',
      opts: { voice: 'alice' },
      text: 'Cancelled.',
    });
    expect(actions[1]).toEqual({ type: 'hangup' });
  });
});
