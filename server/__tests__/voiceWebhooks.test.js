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
      clients: [],
    };

    this.actions.push(dial);

    return {
      number: (to) => {
        dial.numbers.push({ to });
        return this;
      },
      client: (to) => {
        dial.clients.push({ to });
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
// POST /webhooks/voice/client — app-to-app voicemail handoff
// -----------------------------------------------------------------------------

describe('POST /webhooks/voice/client app-to-app voicemail handoff', () => {
  it('rings the Chatforia client for 25 seconds with a voicemail callback', async () => {
    prisma.user.findUnique.mockResolvedValueOnce({
      id: 99,
    });

    const app = createApp();

    const res = await request(app)
      .post('/webhooks/voice/client')
      .type('form')
      .send({
        From: 'client:user_42',
        To: '99',
        backendCallId: '777',
      });

    expect(res.statusCode).toBe(200);

    const actions = JSON.parse(res.text);

    expect(actions).toHaveLength(1);
    expect(actions[0].type).toBe('dial');
    expect(actions[0].opts).toMatchObject({
      answerOnBridge: true,
      timeout: 25,
      method: 'POST',
    });
    expect(actions[0].clients).toEqual([
      {
        to: 'user_99',
      },
    ]);

    const completionUrl = new URL(
      actions[0].opts.action,
      'https://chatforia.test'
    );

    expect(completionUrl.pathname).toBe(
      '/webhooks/voice/app-call-complete'
    );
    expect(completionUrl.searchParams.get('callerUserId')).toBe('42');
    expect(completionUrl.searchParams.get('calleeUserId')).toBe('99');
    expect(completionUrl.searchParams.get('backendCallId')).toBe('777');
  });
});

// -----------------------------------------------------------------------------
// POST /webhooks/voice/app-call-complete
// -----------------------------------------------------------------------------

describe('POST /webhooks/voice/app-call-complete', () => {
  it('stops the unanswered recipient and sends the caller into voicemail', async () => {
    prisma.call.findFirst.mockResolvedValueOnce({
      id: 777,
      callerId: 42,
      calleeId: 99,
      startedAt: null,
    });

    prisma.call.update.mockResolvedValueOnce({
      id: 777,
      callerId: 42,
      calleeId: 99,
      status: 'MISSED',
      endedAt: new Date('2026-07-22T12:00:00.000Z'),
      durationSec: 0,
      endReason: 'no_answer',
    });

    prisma.user.findUnique
      .mockResolvedValueOnce({
        id: 99,
        voicemailEnabled: true,
        voicemailGreetingUrl: null,
        voicemailGreetingText: 'Please leave Julian a message.',
        assignedNumbers: [
          {
            id: 12,
            e164: '+15550009999',
          },
        ],
      })
      .mockResolvedValueOnce({
        id: 42,
        assignedNumbers: [
          {
            e164: '+15550004242',
          },
        ],
      });

    const app = createApp();

    const res = await request(app)
      .post(
        '/webhooks/voice/app-call-complete' +
          '?callerUserId=42' +
          '&calleeUserId=99' +
          '&backendCallId=777'
      )
      .type('form')
      .send({
        DialCallStatus: 'no-answer',
        DialCallDuration: '0',
      });

    expect(res.statusCode).toBe(200);

    const actions = JSON.parse(res.text);

    expect(actions[0]).toEqual({
      type: 'say',
      opts: {},
      text: 'Please leave Julian a message.',
    });

    const recordAction = actions.find(
      (action) => action.type === 'record'
    );

    expect(recordAction).toBeDefined();
    expect(recordAction.opts).toMatchObject({
      playBeep: true,
      maxLength: 120,
      timeout: 5,
      trim: 'trim-silence',
      method: 'POST',
      recordingStatusCallbackMethod: 'POST',
    });

    const completionUrl = new URL(
      recordAction.opts.action,
      'https://chatforia.test'
    );

    const recordingStatusUrl = new URL(
      recordAction.opts.recordingStatusCallback,
      'https://chatforia.test'
    );

    for (const callbackUrl of [completionUrl, recordingStatusUrl]) {
      expect(callbackUrl.searchParams.get('userId')).toBe('99');
      expect(callbackUrl.searchParams.get('phoneNumberId')).toBe('12');
      expect(callbackUrl.searchParams.get('did')).toBe('+15550009999');
      expect(callbackUrl.searchParams.get('from')).toBe('+15550004242');
      expect(callbackUrl.searchParams.get('relatedCallId')).toBe('777');
    }

    expect(prisma.call.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: 777,
        },
        data: expect.objectContaining({
          status: 'MISSED',
          endReason: 'no_answer',
        }),
      })
    );

    expect(emitToUser).toHaveBeenCalledWith(
      99,
      'call:ended',
      expect.objectContaining({
        callId: 777,
        status: 'MISSED',
        reason: 'no_answer',
      })
    );

    expect(emitToUser).not.toHaveBeenCalledWith(
      42,
      'call:ended',
      expect.anything()
    );
  });

  it('preserves an explicit client decline when Twilio later reports no-answer', async () => {
    prisma.call.findFirst.mockResolvedValueOnce({
      id: 777,
      callerId: 42,
      calleeId: 99,
      status: 'DECLINED',
      endReason: 'declined',
      endedAt: new Date('2026-07-23T23:18:57.000Z'),
      startedAt: null,
    });

    const app = createApp();

    const res = await request(app)
      .post(
        '/webhooks/voice/app-call-complete' +
          '?callerUserId=42' +
          '&calleeUserId=99' +
          '&backendCallId=777'
      )
      .type('form')
      .send({
        DialCallStatus: 'no-answer',
        DialCallDuration: '0',
      });

    expect(res.statusCode).toBe(200);

    const actions = JSON.parse(res.text);

    expect(
      actions.some((action) => action.type === 'hangup')
    ).toBe(true);

    expect(
      actions.some((action) => action.type === 'record')
    ).toBe(false);

    expect(prisma.call.update).not.toHaveBeenCalled();
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
    expect(emitToUser).not.toHaveBeenCalled();
  });
});

// -----------------------------------------------------------------------------
// POST /webhooks/voice/app-call-complete — older client fallback
// -----------------------------------------------------------------------------

describe('POST /webhooks/voice/app-call-complete older client fallback', () => {
  it('finds the latest matching audio call when backendCallId is absent', async () => {
    prisma.call.findFirst.mockResolvedValueOnce({
      id: 888,
      callerId: 42,
      calleeId: 99,
      startedAt: null,
    });

    prisma.call.update.mockResolvedValueOnce({
      id: 888,
      callerId: 42,
      calleeId: 99,
      status: 'MISSED',
      endedAt: new Date('2026-07-22T12:00:00.000Z'),
      durationSec: 0,
      endReason: 'no_answer',
    });

    prisma.user.findUnique
      .mockResolvedValueOnce({
        id: 99,
        voicemailEnabled: true,
        voicemailGreetingUrl: null,
        voicemailGreetingText: 'Please leave a message.',
        assignedNumbers: [
          {
            id: 12,
            e164: '+15550009999',
          },
        ],
      })
      .mockResolvedValueOnce({
        id: 42,
        assignedNumbers: [],
      });

    const app = createApp();

    const res = await request(app)
      .post(
        '/webhooks/voice/app-call-complete' +
          '?callerUserId=42' +
          '&calleeUserId=99'
      )
      .type('form')
      .send({
        DialCallStatus: 'no-answer',
        DialCallDuration: '0',
      });

    expect(res.statusCode).toBe(200);

    expect(prisma.call.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          callerId: 42,
          calleeId: 99,
          mode: 'AUDIO',
          status: {
            in: ['INITIATED', 'RINGING', 'ACTIVE'],
          },
          createdAt: {
            gte: expect.any(Date),
          },
        }),
        orderBy: {
          createdAt: 'desc',
        },
      })
    );

    expect(prisma.call.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: 888,
        },
      })
    );

    const actions = JSON.parse(res.text);
    const recordAction = actions.find(
      (action) => action.type === 'record'
    );

    expect(recordAction).toBeDefined();

    const completionUrl = new URL(
      recordAction.opts.action,
      'https://chatforia.test'
    );

    expect(completionUrl.searchParams.get('relatedCallId')).toBe('888');

    expect(emitToUser).toHaveBeenCalledWith(
      99,
      'call:ended',
      expect.objectContaining({
        callId: 888,
        status: 'MISSED',
      })
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