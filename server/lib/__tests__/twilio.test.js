import { jest } from '@jest/globals';

const ORIGINAL_ENV = process.env;

let createMock;
let twilioFactoryMock;

// Mock the 'twilio' package: default export is a factory returning a client
jest.mock('twilio', () => {
  createMock = jest.fn().mockResolvedValue({ sid: 'SM123' });
  twilioFactoryMock = jest.fn(() => ({
    messages: { create: createMock },
  }));
  return { __esModule: true, default: twilioFactoryMock };
});

// Note: twilio.js lives inside telco/, so import that path
const reload = async (env = {}) => {
  jest.resetModules();
  process.env = { ...ORIGINAL_ENV, ...env };

  // Guard: on the very first call after resetModules, these may still be undefined
  if (createMock) createMock.mockReset();
  if (twilioFactoryMock) twilioFactoryMock.mockClear();

  return import('../telco/twilio.js');
};

afterAll(() => {
  process.env = ORIGINAL_ENV;
});

describe('twilio sendSms()', () => {
  test('throws when credentials are missing', async () => {
    const mod = await reload({
      TWILIO_ACCOUNT_SID: '', // missing
      TWILIO_AUTH_TOKEN: 'tok',
    });

    await expect(
      mod.sendSms({ to: '+10000000000', text: 'hi' })
    ).rejects.toThrow('Missing Twilio credentials');

    expect(twilioFactoryMock).not.toHaveBeenCalled();
    expect(createMock).not.toHaveBeenCalled();
  });

  test('uses Messaging Service SID when provided (and includes statusCallback if set)', async () => {
    const mod = await reload({
      TWILIO_ACCOUNT_SID: 'ACxxx',
      TWILIO_AUTH_TOKEN: 'tok',
      TWILIO_MESSAGING_SERVICE_SID: 'MG123',
      TWILIO_STATUS_WEBHOOK_URL: 'https://example.com/callback',
      TWILIO_PHONE_NUMBER: '', // ignored in this path
    });

    const out = await mod.sendSms({
      to: '+15551234567',
      text: 'hello!',
      clientRef: 'ref-1',
    });

    expect(twilioFactoryMock).toHaveBeenCalledWith('ACxxx', 'tok');
    expect(createMock).toHaveBeenCalledWith({
      to: '+15551234567',
      body: 'hello!',
      statusCallback: 'https://example.com/callback',
      messagingServiceSid: 'MG123',
    });
    expect(out).toEqual({
      ok: true,
      provider: 'twilio',
      messageSid: 'SM123',
      clientRef: 'ref-1',
    });
  });

  test('uses FROM number when Messaging Service SID is not set', async () => {
    const mod = await reload({
      TWILIO_ACCOUNT_SID: 'ACxxx',
      TWILIO_AUTH_TOKEN: 'tok',
      TWILIO_MESSAGING_SERVICE_SID: '', // not set
      TWILIO_PHONE_NUMBER: '+18005551234',
      TWILIO_STATUS_WEBHOOK_URL: '', // absent
    });

    const out = await mod.sendSms({
      to: '+14155550123',
      text: 'ping',
    });

    expect(createMock).toHaveBeenCalledWith({
      to: '+14155550123',
      body: 'ping',
      from: '+18005551234',
      // no statusCallback key when unset
    });
    expect(out).toEqual({
      ok: true,
      provider: 'twilio',
      messageSid: 'SM123',
      clientRef: null,
    });
  });

  test('when neither Messaging Service nor FROM is set, forwards params without either (Twilio may reject)', async () => {
    const mod = await reload({
      TWILIO_ACCOUNT_SID: 'ACxxx',
      TWILIO_AUTH_TOKEN: 'tok',
      TWILIO_MESSAGING_SERVICE_SID: '',
      TWILIO_PHONE_NUMBER: '', // both absent
      TWILIO_STATUS_WEBHOOK_URL: '',
    });

    await mod.sendSms({ to: '+19998887777', text: 'no from nor msid' });

    // Current implementation does not throw; it passes no "from" or "messagingServiceSid".
    // If you later add explicit validation, update this test accordingly.
    expect(createMock).toHaveBeenCalledWith({
      to: '+19998887777',
      body: 'no from nor msid',
      // neither "from" nor "messagingServiceSid" present
    });
  });
});
