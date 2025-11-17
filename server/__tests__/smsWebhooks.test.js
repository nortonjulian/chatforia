// __tests__/smsWebhooks.test.js
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

const ORIGINAL_ENV = process.env;

let prismaMock;
let recordInboundSmsMock;
let transporterSendMailMock;
let sendSmsMock;
let normalizeE164Mock;
let isE164Mock;

// -------------------- Mocks --------------------

// prisma client used in the route
await jest.unstable_mockModule('../utils/prismaClient.js', () => {
  prismaMock = {
    user: {
      findUnique: jest.fn(),
    },
  };
  return {
    __esModule: true,
    default: prismaMock,
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

// mailer.transporter
await jest.unstable_mockModule('../services/mailer.js', () => {
  transporterSendMailMock = jest.fn();
  const transporter = { sendMail: transporterSendMailMock };
  return {
    __esModule: true,
    transporter,
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
  isE164Mock = jest.fn(() => true);      // default: treat everything as valid

  return {
    __esModule: true,
    normalizeE164: normalizeE164Mock,
    isE164: isE164Mock,
  };
});

// Import router AFTER mocks
const { default: smsWebhooksRouter } = await import('../routes/smsWebhooks.js');

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
    expect(transporterSendMailMock).not.toHaveBeenCalled();
  });

  test('records inbound SMS but does not forward when recordInboundSms.ok is false', async () => {
    isE164Mock.mockReturnValue(true);
    recordInboundSmsMock.mockResolvedValueOnce({ ok: false, userId: 123 });

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
    });

    // No forwarding when ok is false
    expect(prismaMock.user.findUnique).not.toHaveBeenCalled();
    expect(sendSmsMock).not.toHaveBeenCalled();
    expect(transporterSendMailMock).not.toHaveBeenCalled();
  });

  test('forwards to phone and email when forwarding is enabled and not in quiet hours', async () => {
    isE164Mock.mockReturnValue(true);
    normalizeE164Mock.mockImplementation((n) => n); // keep simple

    recordInboundSmsMock.mockResolvedValueOnce({ ok: true, userId: 999 });

    prismaMock.user.findUnique.mockResolvedValueOnce({
      forwardingEnabledSms: true,
      forwardSmsToPhone: true,
      forwardSmsToEmail: true,
      forwardPhoneNumber: '+18005550123',
      forwardEmail: 'user@example.com',
      forwardQuietHoursStart: null,
      forwardQuietHoursEnd: null,
    });

    process.env.MAIL_FROM = 'noreply@test.app';

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
        forwardingEnabledSms: true,
        forwardSmsToPhone: true,
        forwardSmsToEmail: true,
        forwardPhoneNumber: true,
        forwardEmail: true,
        forwardQuietHoursStart: true,
        forwardQuietHoursEnd: true,
      },
    });

    // Forwarded SMS
    expect(sendSmsMock).toHaveBeenCalledTimes(1);
    const smsArg = sendSmsMock.mock.calls[0][0];

    expect(smsArg.to).toBe('+18005550123');
    expect(smsArg.text).toBe(
      'From +13035550123: Forward this please'.slice(0, 800),
    );
    expect(smsArg.clientRef).toMatch(/^fwd:999:/);

    // Forwarded email
    expect(transporterSendMailMock).toHaveBeenCalledTimes(1);
    expect(transporterSendMailMock).toHaveBeenCalledWith({
      to: 'user@example.com',
      from: 'noreply@test.app',
      subject: 'SMS from +13035550123',
      text: 'Forward this please',
    });
  });

  test('skips forwarding when in quiet hours', async () => {
    isE164Mock.mockReturnValue(true);
    normalizeE164Mock.mockImplementation((n) => n);

    recordInboundSmsMock.mockResolvedValueOnce({ ok: true, userId: 321 });

    // Quiet hours: 0–23 (almost whole day). We'll fake time to 12:00.
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2025-03-01T12:00:00Z'));

    prismaMock.user.findUnique.mockResolvedValueOnce({
      forwardingEnabledSms: true,
      forwardSmsToPhone: true,
      forwardSmsToEmail: true,
      forwardPhoneNumber: '+18005550123',
      forwardEmail: 'user@example.com',
      forwardQuietHoursStart: 0,
      forwardQuietHoursEnd: 23,
    });

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
    expect(transporterSendMailMock).not.toHaveBeenCalled();

    jest.useRealTimers();
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
