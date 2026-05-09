// server/__tests__/voiceWebhooks.test.js

import { jest, describe, it, expect, beforeEach } from '@jest/globals';
import express from 'express';
import request from 'supertest';

// -----------------------------------------------------------------------------
// Mock twilio.twiml.VoiceResponse
// -----------------------------------------------------------------------------

class MockVoiceResponse {
  constructor() {
    this.actions = [];
  }

  say(textOrOpts, maybeText) {
    if (typeof textOrOpts === 'string') {
      this.actions.push({
        type: 'say',
        opts: {},
        text: textOrOpts,
      });
    } else {
      this.actions.push({
        type: 'say',
        opts: textOrOpts || {},
        text: maybeText,
      });
    }

    return this;
  }

  hangup() {
    this.actions.push({ type: 'hangup' });
    return this;
  }

  dial(opts = {}) {
    const dial = {
      type: 'dial',
      opts,
      numbers: [],
    };

    this.actions.push(dial);

    return {
      number: (to) => {
        dial.numbers.push({ to });
        return this;
      },
    };
  }

  record(opts = {}) {
    this.actions.push({
      type: 'record',
      opts,
    });

    return this;
  }

  toString() {
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

// -----------------------------------------------------------------------------
// Mock phone utils
// -----------------------------------------------------------------------------

jest.unstable_mockModule('../utils/phone.js', () => ({
  __esModule: true,

  normalizeE164: (v) => String(v || '').trim(),

  isE164: (v) => /^\+\d{6,}$/.test(String(v || '')),
}));

// -----------------------------------------------------------------------------
// Mock express-rate-limit
// -----------------------------------------------------------------------------

jest.unstable_mockModule('express-rate-limit', () => ({
  __esModule: true,
  default: () => (_req, _res, next) => next(),
}));

// -----------------------------------------------------------------------------
// Mock prisma
// -----------------------------------------------------------------------------

const prisma = {
  phoneNumber: {
    findUnique: jest.fn(),
  },

  call: {
    create: jest.fn(),
    findFirst: jest.fn(),
    update: jest.fn(),
  },

  user: {
    findUnique: jest.fn(),
  },

  voiceLog: {
    upsert: jest.fn(),
  },
};

jest.unstable_mockModule('../utils/prismaClient.js', () => ({
  __esModule: true,
  default: prisma,
}));

// -----------------------------------------------------------------------------
// Mock socket bus + push
// -----------------------------------------------------------------------------

const emitToUser = jest.fn();

jest.unstable_mockModule('../services/socketBus.js', () => ({
  __esModule: true,
  emitToUser,
}));

const sendIncomingForwardedCallPush = jest.fn(async () => undefined);

jest.unstable_mockModule('../services/pushService.js', () => ({
  __esModule: true,
  sendIncomingForwardedCallPush,
}));

// -----------------------------------------------------------------------------
// Import router AFTER mocks
// -----------------------------------------------------------------------------

const { default: voiceRouter } = await import(
  '../routes/voiceWebhooks.js'
);

// -----------------------------------------------------------------------------
// App helper
// -----------------------------------------------------------------------------

function createApp() {
  const app = express();

  app.use('/webhooks/voice', voiceRouter);

  return app;
}

beforeEach(() => {
  jest.clearAllMocks();
});

// -----------------------------------------------------------------------------
// POST /webhooks/voice/client
// -----------------------------------------------------------------------------

describe('POST /webhooks/voice/client', () => {
  it('rejects missing destination', async () => {
    const app = createApp();

    const res = await request(app)
      .post('/webhooks/voice/client')
      .type('form')
      .send({
        From: 'client:user:7',
      });

    expect(res.statusCode).toBe(200);

    expect(res.headers['content-type']).toMatch(/text\/xml/);

    const actions = JSON.parse(res.text);

    expect(actions[0]).toEqual({
      type: 'say',
      opts: {},
      text: 'Missing destination.',
    });

    expect(actions[1]).toEqual({
      type: 'hangup',
    });
  });

  it('rejects invalid destination number', async () => {
    const app = createApp();

    const res = await request(app)
      .post('/webhooks/voice/client')
      .type('form')
      .send({
        From: 'client:user:7',
        To: 'abc123',
      });

    expect(res.statusCode).toBe(200);

    const actions = JSON.parse(res.text);

    expect(actions[0]).toEqual({
      type: 'say',
      opts: {},
      text: 'The number you dialed is not valid.',
    });

    expect(actions[1]).toEqual({
      type: 'hangup',
    });
  });

  it('dials valid destination with fallback caller ID', async () => {
    process.env.TWILIO_DEFAULT_CALLER_ID = '+15559990000';

    prisma.user.findUnique.mockResolvedValueOnce({
      assignedNumbers: [],
    });

    const app = createApp();

    const res = await request(app)
      .post('/webhooks/voice/client')
      .type('form')
      .send({
        From: 'client:user:42',
        To: '+15551112222',
      });

    expect(res.statusCode).toBe(200);

    const actions = JSON.parse(res.text);

    expect(actions[0].type).toBe('dial');

    expect(actions[0].opts).toEqual({
      callerId: '+15559990000',
    });

    expect(actions[0].numbers).toEqual([
      {
        to: '+15551112222',
      },
    ]);
  });

  it('uses assigned number as callerId when available', async () => {
    prisma.user.findUnique.mockResolvedValueOnce({
      assignedNumbers: [
        {
          e164: '+15558887777',
        },
      ],
    });

    const app = createApp();

    const res = await request(app)
      .post('/webhooks/voice/client')
      .type('form')
      .send({
        From: 'client:user:99',
        To: '+15550001111',
      });

    expect(res.statusCode).toBe(200);

    const actions = JSON.parse(res.text);

    expect(actions[0].opts).toEqual({
      callerId: '+15558887777',
    });

    expect(actions[0].numbers).toEqual([
      {
        to: '+15550001111',
      },
    ]);
  });
});

// -----------------------------------------------------------------------------
// POST /webhooks/voice/inbound
// -----------------------------------------------------------------------------

describe('POST /webhooks/voice/inbound', () => {
  it('rejects invalid destination number', async () => {
    const app = createApp();

    const res = await request(app)
      .post('/webhooks/voice/inbound')
      .type('form')
      .send({
        To: 'abc',
        From: '+15550001111',
      });

    expect(res.statusCode).toBe(200);

    const actions = JSON.parse(res.text);

    expect(actions[0]).toEqual({
      type: 'say',
      opts: {},
      text: 'The number called is not valid.',
    });

    expect(actions[1]).toEqual({
      type: 'hangup',
    });
  });

  it('hangs up when assigned number not found', async () => {
    prisma.phoneNumber.findUnique.mockResolvedValueOnce(null);

    const app = createApp();

    const res = await request(app)
      .post('/webhooks/voice/inbound')
      .type('form')
      .send({
        To: '+15550009999',
        From: '+15550001111',
      });

    expect(res.statusCode).toBe(200);

    const actions = JSON.parse(res.text);

    expect(actions[0]).toEqual({
      type: 'say',
      opts: {},
      text: 'This number is not available.',
    });

    expect(actions[1]).toEqual({
      type: 'hangup',
    });
  });

  it('dials forwarding number when forwarding enabled', async () => {
    prisma.phoneNumber.findUnique.mockResolvedValueOnce({
      id: 1,
      e164: '+15550009999',
      assignedUserId: 42,

      assignedUser: {
        id: 42,
        forwardingEnabledCalls: true,
        forwardToPhoneE164: '+15556667777',
        forwardQuietHoursStart: null,
        forwardQuietHoursEnd: null,
        voicemailEnabled: false,
      },
    });

    prisma.call.create.mockResolvedValueOnce({
      id: 123,
      createdAt: new Date(),
      twilioCallSid: 'CA123',
    });

    const app = createApp();

    const res = await request(app)
      .post('/webhooks/voice/inbound')
      .type('form')
      .send({
        To: '+15550009999',
        From: '+15550001111',
        CallSid: 'CA123',
      });

    expect(res.statusCode).toBe(200);

    const actions = JSON.parse(res.text);

    expect(actions[0].type).toBe('dial');

    expect(actions[0].opts.callerId).toBe('+15550009999');

    expect(actions[0].numbers).toEqual([
      {
        to: '+15556667777',
      },
    ]);

    expect(emitToUser).toHaveBeenCalled();
    expect(sendIncomingForwardedCallPush).toHaveBeenCalled();
  });

  it('records voicemail when voicemail enabled', async () => {
    prisma.phoneNumber.findUnique.mockResolvedValueOnce({
      id: 1,
      e164: '+15550009999',
      assignedUserId: 42,

      assignedUser: {
        id: 42,
        forwardingEnabledCalls: false,
        forwardToPhoneE164: null,
        forwardQuietHoursStart: null,
        forwardQuietHoursEnd: null,
        voicemailEnabled: true,
        voicemailGreetingText:
          'Please leave your message after the tone.',
      },
    });

    prisma.call.create.mockResolvedValueOnce({
      id: 321,
      createdAt: new Date(),
      twilioCallSid: 'CA999',
    });

    const app = createApp();

    const res = await request(app)
      .post('/webhooks/voice/inbound')
      .type('form')
      .send({
        To: '+15550009999',
        From: '+15550001111',
      });

    expect(res.statusCode).toBe(200);

    const actions = JSON.parse(res.text);

    expect(actions[0]).toEqual({
      type: 'say',
      opts: {},
      text: 'Please leave your message after the tone.',
    });

    expect(actions[1].type).toBe('record');

    expect(actions[1].opts.action).toBe(
      '/webhooks/voice/voicemail-complete'
    );
  });
});

// -----------------------------------------------------------------------------
// POST /webhooks/voice/status
// -----------------------------------------------------------------------------

describe('POST /webhooks/voice/status', () => {
  it('logs Twilio status callback', async () => {
    prisma.voiceLog.upsert.mockResolvedValueOnce({});

    const app = createApp();

    const res = await request(app)
      .post('/webhooks/voice/status')
      .type('form')
      .send({
        CallSid: 'CA123',
        CallStatus: 'completed',
        From: '+15550001111',
        To: '+15550002222',
      });

    expect(res.statusCode).toBe(200);

    expect(prisma.voiceLog.upsert).toHaveBeenCalled();
  });
});

// -----------------------------------------------------------------------------
// POST /webhooks/voice/dial-complete
// -----------------------------------------------------------------------------

describe('POST /webhooks/voice/dial-complete', () => {
  it('records MISSED for no-answer and records voicemail', async () => {
    prisma.call.findFirst.mockResolvedValueOnce({
      id: 777,
      callerId: 42,
      startedAt: null,
    });

    prisma.call.update.mockResolvedValueOnce({
      id: 777,
      callerId: 42,
      status: 'MISSED',
      endedAt: new Date(),
      durationSec: 0,
      endReason: 'no_answer',
    });

    const app = createApp();

    const res = await request(app)
      .post('/webhooks/voice/dial-complete')
      .type('form')
      .send({
        CallSid: 'CA123',
        DialCallStatus: 'no-answer',
      });

    expect(res.statusCode).toBe(200);

    const actions = JSON.parse(res.text);

    expect(actions[0]).toEqual({
      type: 'say',
      opts: {},
      text:
        'The person you called is unavailable. Please leave a message after the tone.',
    });

    expect(actions[1].type).toBe('record');

    expect(prisma.call.update).toHaveBeenCalled();

    expect(emitToUser).toHaveBeenCalled();
  });

  it('returns empty TwiML for completed call', async () => {
    prisma.call.findFirst.mockResolvedValueOnce({
      id: 555,
      callerId: 7,
      startedAt: new Date(),
    });

    prisma.call.update.mockResolvedValueOnce({
      id: 555,
      callerId: 7,
      status: 'ENDED',
      endedAt: new Date(),
      durationSec: 20,
      endReason: 'completed',
    });

    const app = createApp();

    const res = await request(app)
      .post('/webhooks/voice/dial-complete')
      .type('form')
      .send({
        CallSid: 'CA999',
        DialCallStatus: 'completed',
        DialCallDuration: '20',
      });

    expect(res.statusCode).toBe(200);

    const actions = JSON.parse(res.text);

    expect(actions).toEqual([]);
  });
});