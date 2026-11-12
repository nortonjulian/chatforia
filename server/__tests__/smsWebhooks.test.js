import {
  jest,
  describe,
  test,
  expect,
  beforeEach,
  afterAll,
} from '@jest/globals';
import express from 'express';
import request from 'supertest';
import twilio from 'twilio';

import { installTwilioCallbackGuards } from '../middleware/twilioSignature.js';

const ORIGINAL_ENV = process.env;

let prismaMock;
let recordInboundSmsMock;
let assertAndConsumeUsageMock;
let releaseUsageMock;
let sendMailMock;
let isEmailAvailableMock;
let sendSmsMock;
let normalizeE164Mock;
let isE164Mock;

// -------------------- Mocks --------------------

// prisma client used in the route
await jest.unstable_mockModule('../utils/prismaClient.js', () => {
  prismaMock = {
    $transaction: jest.fn((callback) => callback(prismaMock)),
    smsCarrierEvent: {
      create: jest.fn(),
      findUnique: jest.fn(),
    },
    user: {
      findUnique: jest.fn(),
    },
    smsOptOut: {
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      deleteMany: jest.fn(),
    },
  };

  return {
    __esModule: true,
    default: prismaMock,
  };
});

describe('signed Twilio SMS handler', () => {
  test.each(['/webhooks/sms/twilio', '/api/webhooks/sms/twilio'])(
    'rejects unauthenticated STOP before opt-out writes and accepts signed STOP at %s',
    async (path) => {
      process.env.TWILIO_AUTH_TOKEN = 'synthetic_sms_token';
      process.env.TWILIO_WEBHOOK_BASE_URL = 'https://api.example.test';
      const securedApp = express();
      installTwilioCallbackGuards(securedApp);
      securedApp.use('/webhooks/sms', smsWebhooksRouter);
      securedApp.use('/api/webhooks/sms', smsWebhooksRouter);

      const body = {
        From: '+15550001111',
        To: '+15550002222',
        Body: 'STOP',
        MessageSid: 'SM-synthetic-stop',
      };
      await request(securedApp).post(path).type('form').send(body).expect(403);
      expect(prismaMock.smsCarrierEvent.create).not.toHaveBeenCalled();
      expect(prismaMock.smsOptOut.findFirst).not.toHaveBeenCalled();
      expect(prismaMock.smsOptOut.create).not.toHaveBeenCalled();
      expect(recordInboundSmsMock).not.toHaveBeenCalled();

      const signature = twilio.getExpectedTwilioSignature(
        process.env.TWILIO_AUTH_TOKEN,
        `https://api.example.test${path}`,
        body
      );
      await request(securedApp).post(path)
        .set('X-Twilio-Signature', signature).type('form').send(body).expect(200);
      expect(prismaMock.smsOptOut.create).toHaveBeenCalledTimes(1);
      expect(recordInboundSmsMock).not.toHaveBeenCalled();
    }
  );

  test('does not write the same signed STOP SID twice', async () => {
    process.env.TWILIO_AUTH_TOKEN = 'synthetic_sms_token';
    process.env.TWILIO_WEBHOOK_BASE_URL = 'https://api.example.test';
    const securedApp = express();
    installTwilioCallbackGuards(securedApp);
    securedApp.use('/webhooks/sms', smsWebhooksRouter);
    prismaMock.smsOptOut.findFirst.mockResolvedValueOnce(null);
    prismaMock.smsCarrierEvent.create.mockResolvedValueOnce({ id: 1 })
      .mockRejectedValueOnce(Object.assign(new Error('duplicate'), { code: 'P2002' }));
    prismaMock.smsCarrierEvent.findUnique.mockResolvedValueOnce({ id: 1 });

    const body = {
      From: '+15550001111',
      To: '+15550002222',
      Body: 'STOP',
      MessageSid: 'SM-repeat',
    };
    const signature = twilio.getExpectedTwilioSignature(
      process.env.TWILIO_AUTH_TOKEN,
      'https://api.example.test/webhooks/sms/twilio',
      body
    );
    const post = () => request(securedApp).post('/webhooks/sms/twilio')
      .set('X-Twilio-Signature', signature).type('form').send(body);
    await post().expect(200);
    await post().expect(200);

    expect(prismaMock.smsOptOut.create).toHaveBeenCalledTimes(1);
    expect(prismaMock.smsOptOut.update).not.toHaveBeenCalled();
    expect(prismaMock.smsCarrierEvent.findUnique).toHaveBeenCalledWith({
      where: { providerMessageId: 'SM-repeat' },
    });
  });

  test('an old STOP retry after START cannot restore an opt-out; a new STOP can', async () => {
    process.env.TWILIO_AUTH_TOKEN = 'synthetic_sms_token';
    process.env.TWILIO_WEBHOOK_BASE_URL = 'https://api.example.test';
    const securedApp = express();
    installTwilioCallbackGuards(securedApp);
    securedApp.use('/webhooks/sms', smsWebhooksRouter);

    const seen = new Set();
    prismaMock.smsCarrierEvent.create.mockImplementation(async ({ data }) => {
      if (seen.has(data.providerMessageId)) {
        throw Object.assign(new Error('duplicate'), { code: 'P2002' });
      }
      seen.add(data.providerMessageId);
      return { id: seen.size };
    });
    prismaMock.smsCarrierEvent.findUnique.mockImplementation(async ({ where }) =>
      seen.has(where.providerMessageId) ? { id: 1 } : null
    );
    prismaMock.smsOptOut.findFirst.mockResolvedValue(null);

    const sendAction = (Body, MessageSid) => {
      const body = { From: '+15550001111', To: '+15550002222', Body, MessageSid };
      const signature = twilio.getExpectedTwilioSignature(
        process.env.TWILIO_AUTH_TOKEN,
        'https://api.example.test/webhooks/sms/twilio',
        body
      );
      return request(securedApp).post('/webhooks/sms/twilio')
        .set('X-Twilio-Signature', signature).type('form').send(body);
    };
    await sendAction('STOP', 'SM-old-stop').expect(200);
    await sendAction('START', 'SM-start').expect(200);
    await sendAction('STOP', 'SM-old-stop').expect(200);
    expect(prismaMock.smsOptOut.deleteMany).toHaveBeenCalledTimes(1);
    expect(prismaMock.smsOptOut.create).toHaveBeenCalledTimes(1);

    await sendAction('STOP', 'SM-new-stop').expect(200);
    expect(prismaMock.smsOptOut.create).toHaveBeenCalledTimes(2);
    await sendAction('START', 'SM-start').expect(200);
    expect(prismaMock.smsOptOut.deleteMany).toHaveBeenCalledTimes(1);
    expect(prismaMock.smsCarrierEvent.create).toHaveBeenCalledTimes(5);
  });

  test('STOP and START without a SID, or a failed receipt, never change consent', async () => {
    process.env.TWILIO_AUTH_TOKEN = 'synthetic_sms_token';
    process.env.TWILIO_WEBHOOK_BASE_URL = 'https://api.example.test';
    const securedApp = express();
    installTwilioCallbackGuards(securedApp);
    securedApp.use('/webhooks/sms', smsWebhooksRouter);
    const post = (body) => {
      const signature = twilio.getExpectedTwilioSignature(
        process.env.TWILIO_AUTH_TOKEN,
        'https://api.example.test/webhooks/sms/twilio',
        body
      );
      return request(securedApp).post('/webhooks/sms/twilio')
        .set('X-Twilio-Signature', signature).type('form').send(body);
    };
    for (const Body of ['STOP', 'START']) {
      await post({ From: '+15550001111', To: '+15550002222', Body }).expect(400);
    }
    expect(prismaMock.smsCarrierEvent.create).not.toHaveBeenCalled();
    expect(prismaMock.smsOptOut.create).not.toHaveBeenCalled();
    expect(prismaMock.smsOptOut.deleteMany).not.toHaveBeenCalled();

    prismaMock.smsCarrierEvent.create.mockRejectedValueOnce(new Error('storage failure'));
    await post({ From: '+15550001111', To: '+15550002222', Body: 'STOP', MessageSid: 'SM-failed' }).expect(503);
    expect(prismaMock.smsOptOut.create).not.toHaveBeenCalled();

    prismaMock.smsCarrierEvent.create.mockRejectedValueOnce(
      Object.assign(new Error('other unique conflict'), { code: 'P2002' })
    );
    prismaMock.smsCarrierEvent.findUnique.mockResolvedValueOnce(null);
    await post({ From: '+15550001111', To: '+15550002222', Body: 'START', MessageSid: 'SM-other-conflict' }).expect(503);
    expect(prismaMock.smsOptOut.deleteMany).not.toHaveBeenCalled();
  });

  test('passes signed MMS fields to the existing inbound handler', async () => {
    process.env.TWILIO_AUTH_TOKEN = 'synthetic_sms_token';
    process.env.TWILIO_WEBHOOK_BASE_URL = 'https://api.example.test';
    const securedApp = express();
    installTwilioCallbackGuards(securedApp);
    securedApp.use('/api/webhooks/sms', smsWebhooksRouter);
    recordInboundSmsMock.mockResolvedValueOnce({ ok: false });

    const body = {
      From: '+15550001111',
      To: '+15550002222',
      Body: '',
      MessageSid: 'SM-synthetic-media',
      NumMedia: '1',
      MediaUrl0: 'https://media.example.test/synthetic',
      MediaContentType0: 'image/png',
    };
    const signature = twilio.getExpectedTwilioSignature(
      process.env.TWILIO_AUTH_TOKEN,
      'https://api.example.test/api/webhooks/sms/twilio',
      body
    );
    await request(securedApp).post('/api/webhooks/sms/twilio')
      .set('X-Twilio-Signature', signature).type('form').send(body).expect(200);
    expect(recordInboundSmsMock).toHaveBeenCalledWith(expect.objectContaining({
      providerMessageId: 'SM-synthetic-media',
      media: [{
        url: 'https://media.example.test/synthetic',
        contentType: 'image/png',
      }],
    }));
  });
});

await jest.unstable_mockModule('../utils/sendMail.js', () => {
  sendMailMock = jest.fn();
  isEmailAvailableMock = jest.fn(() => true);

  return {
    __esModule: true,
    sendMail: sendMailMock,
    isEmailAvailable: isEmailAvailableMock,
  };
});

// smsService.recordInboundSms
await jest.unstable_mockModule('../services/smsService.js', () => {
  recordInboundSmsMock = jest.fn();

  return {
    __esModule: true,
    recordInboundSms: recordInboundSmsMock,
  };
});

await jest.unstable_mockModule('../services/planUsageService.js', () => {
  assertAndConsumeUsageMock = jest.fn();
  releaseUsageMock = jest.fn();

  return {
    __esModule: true,
    assertAndConsumeUsage: assertAndConsumeUsageMock,
    releaseUsage: releaseUsageMock,
  };
});

// telco sendSms
await jest.unstable_mockModule('../lib/telco/index.js', () => {
  sendSmsMock = jest.fn();

  return {
    __esModule: true,
    sendSms: sendSmsMock,
  };
});

// phone utils normalizeE164 + isE164
await jest.unstable_mockModule('../utils/phone.js', () => {
  normalizeE164Mock = jest.fn((n) => n); // default: pass-through
  isE164Mock = jest.fn(() => true); // default: treat everything as valid

  return {
    __esModule: true,
    normalizeE164: normalizeE164Mock,
    isE164: isE164Mock,
  };
});

// Import router AFTER mocks
const { default: smsWebhooksRouter } = await import(
  '../routes/smsWebhooks.js'
);

// Build test app
const app = express();
app.use('/webhooks/sms', smsWebhooksRouter);

beforeEach(() => {
  jest.clearAllMocks();
  process.env = { ...ORIGINAL_ENV };
});

afterAll(() => {
  process.env = ORIGINAL_ENV;
});

// -------------------- Tests --------------------

describe('POST /webhooks/sms/twilio', () => {
  test('ignores invalid payload (no valid E164 or empty body) and still returns 200', async () => {
    // Force isE164 to always return false for this test
    isE164Mock.mockReturnValue(false);

    const res = await request(app)
      .post('/webhooks/sms/twilio')
      .type('form')
      .send({
        From: 'not-a-number',
        To: 'also-bad',
        Body: '',
      });

    expect(res.status).toBe(200);

    expect(recordInboundSmsMock).not.toHaveBeenCalled();
    expect(prismaMock.user.findUnique).not.toHaveBeenCalled();
    expect(sendSmsMock).not.toHaveBeenCalled();
    expect(sendMailMock).not.toHaveBeenCalled();
  });

  test('records inbound SMS but does not forward when recordInboundSms.ok is false', async () => {
    isE164Mock.mockReturnValue(true);

    recordInboundSmsMock.mockResolvedValueOnce({
      ok: false,
      userId: 123,
    });

    const res = await request(app)
      .post('/webhooks/sms/twilio')
      .type('form')
      .send({
        From: '+13035550123',
        To: '+17205550123',
        Body: 'Hello',
        MessageSid: 'SM123',
      });

    expect(res.status).toBe(200);

    expect(normalizeE164Mock).toHaveBeenCalledWith('+17205550123');
    expect(normalizeE164Mock).toHaveBeenCalledWith('+13035550123');

    expect(recordInboundSmsMock).toHaveBeenCalledTimes(1);

    expect(recordInboundSmsMock).toHaveBeenCalledWith({
      toNumber: '+17205550123',
      fromNumber: '+13035550123',
      body: 'Hello',
      provider: 'twilio',
      providerMessageId: 'SM123',
      media: [],
    });

    // No forwarding when ok is false
    expect(prismaMock.user.findUnique).not.toHaveBeenCalled();
    expect(sendSmsMock).not.toHaveBeenCalled();
    expect(sendMailMock).not.toHaveBeenCalled();
  });

  test('forwards to phone and email when forwarding is enabled and not in quiet hours', async () => {
    isE164Mock.mockReturnValue(true);
    normalizeE164Mock.mockImplementation((n) => n);

    recordInboundSmsMock.mockResolvedValueOnce({
      ok: true,
      userId: 999,
    });

    prismaMock.user.findUnique.mockResolvedValueOnce({
      plan: 'PLUS',
      forwardingEnabledSms: true,
      forwardSmsToPhone: true,
      forwardSmsToEmail: true,
      forwardPhoneNumber: '+18005550123',
      forwardEmail: 'user@example.com',
      forwardQuietHoursStart: null,
      forwardQuietHoursEnd: null,
    });

    process.env.EMAIL_FROM = 'hello@test.app';

    const res = await request(app)
      .post('/webhooks/sms/twilio')
      .type('form')
      .send({
        From: '+13035550123',
        To: '+17205550123',
        Body: 'Forward this please',
        MessageSid: 'SM999',
      });

    expect(res.status).toBe(200);

    // DB user lookup
    expect(prismaMock.user.findUnique).toHaveBeenCalledWith({
      where: { id: 999 },
      select: {
        plan: true,
        forwardingEnabledSms: true,
        forwardSmsToPhone: true,
        forwardSmsToEmail: true,
        forwardPhoneNumber: true,
        forwardEmail: true,
        forwardQuietHoursStart: true,
        forwardQuietHoursEnd: true,
        forwardQuietHoursTimeZone: true,
      },
    });

    expect(assertAndConsumeUsageMock).toHaveBeenCalledWith({
      userId: 999,
      plan: 'PLUS',
      meter: 'smsMessages',
      amount: 1,
    });

    expect(releaseUsageMock).not.toHaveBeenCalled();

    // Forwarded SMS
    expect(sendSmsMock).toHaveBeenCalledTimes(1);

    const smsArg = sendSmsMock.mock.calls[0][0];

    expect(smsArg.to).toBe('+18005550123');

    expect(smsArg.text).toBe(
      'From +13035550123: Forward this please'.slice(0, 800),
    );

    expect(smsArg.clientRef).toMatch(/^fwd:999:/);

    // Forwarded email
    expect(sendMailMock).toHaveBeenCalledTimes(1);

    expect(sendMailMock).toHaveBeenCalledWith({
      to: 'user@example.com',
      subject: 'SMS from +13035550123',
      text: 'Forward this please',
    });
  });

  test('records but does not forward when a paid account disables SMS forwarding', async () => {
    isE164Mock.mockReturnValue(true);
    recordInboundSmsMock.mockResolvedValueOnce({ ok: true, userId: 777 });
    prismaMock.user.findUnique.mockResolvedValueOnce({
      plan: 'PLUS',
      forwardingEnabledSms: false,
      forwardSmsToPhone: true,
      forwardSmsToEmail: true,
      forwardPhoneNumber: '+18005550123',
      forwardEmail: 'user@example.com',
      forwardQuietHoursStart: null,
      forwardQuietHoursEnd: null,
    });
    const res = await request(app).post('/webhooks/sms/twilio').type('form').send({
      From: '+13035550123', To: '+17205550123', Body: 'Keep this local', MessageSid: 'SM-disabled',
    });
    expect(res.status).toBe(200);
    expect(prismaMock.user.findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 777 } }));
    expect(sendSmsMock).not.toHaveBeenCalled();
    expect(sendMailMock).not.toHaveBeenCalled();
  });

  test('skips phone forwarding at the SMS allowance but still forwards to email', async () => {
    isE164Mock.mockReturnValue(true);
    normalizeE164Mock.mockImplementation((n) => n);

    recordInboundSmsMock.mockResolvedValueOnce({
      ok: true,
      userId: 999,
    });

    prismaMock.user.findUnique.mockResolvedValueOnce({
      plan: 'PLUS',
      forwardingEnabledSms: true,
      forwardSmsToPhone: true,
      forwardSmsToEmail: true,
      forwardPhoneNumber: '+18005550123',
      forwardEmail: 'user@example.com',
      forwardQuietHoursStart: null,
      forwardQuietHoursEnd: null,
    });

    const allowanceError = new Error('Plan allowance exceeded');
    allowanceError.code = 'PLAN_ALLOWANCE_EXCEEDED';

    assertAndConsumeUsageMock.mockRejectedValueOnce(allowanceError);

    process.env.EMAIL_FROM = 'hello@test.app';

    const res = await request(app)
      .post('/webhooks/sms/twilio')
      .type('form')
      .send({
        From: '+13035550123',
        To: '+17205550123',
        Body: 'Forward this please',
        MessageSid: 'SM-LIMIT',
      });

    expect(res.status).toBe(200);

    expect(assertAndConsumeUsageMock).toHaveBeenCalledWith({
      userId: 999,
      plan: 'PLUS',
      meter: 'smsMessages',
      amount: 1,
    });

    expect(sendSmsMock).not.toHaveBeenCalled();
    expect(releaseUsageMock).not.toHaveBeenCalled();

    expect(sendMailMock).toHaveBeenCalledTimes(1);
    expect(sendMailMock).toHaveBeenCalledWith({
      to: 'user@example.com',
      subject: 'SMS from +13035550123',
      text: 'Forward this please',
    });
  });

  test.each(['FREE', 'WIRELESS'])(
    'does not execute saved SMS forwarding for %s after downgrade',
    async (plan) => {
      isE164Mock.mockReturnValue(true);
      normalizeE164Mock.mockImplementation((n) => n);

      recordInboundSmsMock.mockResolvedValueOnce({
        ok: true,
        userId: 999,
      });

      prismaMock.user.findUnique.mockResolvedValueOnce({
        plan,
        forwardingEnabledSms: true,
        forwardSmsToPhone: true,
        forwardSmsToEmail: true,
        forwardPhoneNumber: '+18005550123',
        forwardEmail: 'user@example.com',
        forwardQuietHoursStart: null,
        forwardQuietHoursEnd: null,
      });

      const res = await request(app)
        .post('/webhooks/sms/twilio')
        .type('form')
        .send({
          From: '+13035550123',
          To: '+17205550123',
          Body: 'Do not forward this',
          MessageSid: `SM-DOWNGRADE-${plan}`,
        });

      expect(res.status).toBe(200);

      expect(assertAndConsumeUsageMock).not.toHaveBeenCalled();
      expect(sendSmsMock).not.toHaveBeenCalled();
      expect(sendMailMock).not.toHaveBeenCalled();
    }
  );

  test('skips forwarding when in quiet hours', async () => {
    isE164Mock.mockReturnValue(true);
    normalizeE164Mock.mockImplementation((n) => n);

    recordInboundSmsMock.mockResolvedValueOnce({
      ok: true,
      userId: 321,
    });

    prismaMock.user.findUnique.mockResolvedValueOnce({
      plan: 'PLUS',
      forwardingEnabledSms: true,
      forwardSmsToPhone: true,
      forwardSmsToEmail: true,
      forwardPhoneNumber: '+18005550123',
      forwardEmail: 'user@example.com',
      forwardQuietHoursStart: 0,
      forwardQuietHoursEnd: 23,
    });

    jest.useFakeTimers();
    jest.setSystemTime(new Date('2025-03-01T12:00:00Z'));

    try {
      const res = await request(app)
        .post('/webhooks/sms/twilio')
        .type('form')
        .send({
          From: '+13035550123',
          To: '+17205550123',
          Body: 'Quiet please',
        });

      expect(res.status).toBe(200);

      expect(recordInboundSmsMock).toHaveBeenCalledTimes(1);
      expect(prismaMock.user.findUnique).toHaveBeenCalledTimes(1);

      // No forwarding due to quiet hours
      expect(sendSmsMock).not.toHaveBeenCalled();
      expect(sendMailMock).not.toHaveBeenCalled();
    } finally {
      jest.useRealTimers();
    }
  });

  test('uses the saved zone rather than UTC when suppressing SMS forwarding', async () => {
    isE164Mock.mockReturnValue(true);
    normalizeE164Mock.mockImplementation((n) => n);
    recordInboundSmsMock.mockResolvedValueOnce({ ok: true, userId: 321 });
    prismaMock.user.findUnique.mockResolvedValueOnce({
      plan: 'PLUS', forwardingEnabledSms: true, forwardSmsToPhone: true,
      forwardSmsToEmail: true, forwardPhoneNumber: '+18005550123',
      forwardEmail: 'user@example.com', forwardQuietHoursStart: 22,
      forwardQuietHoursEnd: 23, forwardQuietHoursTimeZone: 'America/Denver',
    });
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-11-10T05:00:00Z'));
    try {
      const res = await request(app).post('/webhooks/sms/twilio').type('form').send({
        From: '+13035550123', To: '+17205550123', Body: 'Synthetic zone check',
      });
      expect(res.status).toBe(200);
      expect(sendSmsMock).not.toHaveBeenCalled();
      expect(sendMailMock).not.toHaveBeenCalled();
    } finally { jest.useRealTimers(); }
  });

  test('returns 500 when an exception is thrown', async () => {
    isE164Mock.mockReturnValue(true);
    normalizeE164Mock.mockImplementation((n) => n);

    const err = new Error('DB down');

    recordInboundSmsMock.mockRejectedValueOnce(err);

    const consoleErrorSpy = jest
      .spyOn(console, 'error')
      .mockImplementation(() => {});

    const res = await request(app)
      .post('/webhooks/sms/twilio')
      .type('form')
      .send({
        From: '+13035550123',
        To: '+17205550123',
        Body: 'Will trigger error',
      });

    expect(res.status).toBe(500);

    expect(consoleErrorSpy).toHaveBeenCalledWith(
      '[webhook][twilio] error',
      err,
    );

    consoleErrorSpy.mockRestore();
  });
});
