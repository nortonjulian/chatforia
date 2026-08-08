import { jest } from '@jest/globals';

const ORIGINAL_ENV = process.env;

let createMock;
let incomingNumberCreateMock;
let messagingServicePhoneNumberCreateMock;
let twilioFactoryMock;

jest.mock('twilio', () => {
  createMock = jest.fn().mockResolvedValue({ sid: 'SM123' });

  messagingServicePhoneNumberCreateMock =
    jest.fn().mockResolvedValue({
      sid: 'PN123',
    });

  incomingNumberCreateMock = jest.fn().mockResolvedValue({
    sid: 'PN123',
    phoneNumber: '+15551234567',
    isoCountry: 'US',
    capabilities: {
      voice: true,
      sms: true,
    },
    locality: 'Denver',
    region: 'CO',
  });

  twilioFactoryMock = jest.fn(() => ({
    messages: { create: createMock },
    incomingPhoneNumbers: {
      create: incomingNumberCreateMock,
    },
    messaging: {
      v1: {
        services: jest.fn(() => ({
          phoneNumbers: {
            create:
              messagingServicePhoneNumberCreateMock,
          },
        })),
      },
    },
  }));

  return { __esModule: true, default: twilioFactoryMock };
});

const reload = async (env = {}) => {
  jest.resetModules();

  process.env = {
    ...ORIGINAL_ENV,
    ...env,
  };

  if (createMock) createMock.mockClear();
  if (incomingNumberCreateMock) {
    incomingNumberCreateMock.mockClear();
  }
  if (messagingServicePhoneNumberCreateMock) {
    messagingServicePhoneNumberCreateMock.mockClear();
  }
  if (twilioFactoryMock) twilioFactoryMock.mockClear();

  const mod = await import('../telco/twilio.js');

  // twilio.js exports the adapter as default:
  // { providerName, sendSms, searchAvailable, purchaseNumber, releaseNumber }
  return mod.default;
};

afterAll(() => {
  process.env = ORIGINAL_ENV;
});

describe('twilio sendSms()', () => {
  test('throws when credentials are missing', async () => {
    const mod = await reload({
      TWILIO_ACCOUNT_SID: '',
      TWILIO_AUTH_TOKEN: 'tok',
    });

    await expect(
      mod.sendSms({ to: '+10000000000', text: 'hi' })
    ).rejects.toThrow('Twilio not configured');

    expect(twilioFactoryMock).not.toHaveBeenCalled();
    expect(createMock).not.toHaveBeenCalled();
  });

  test('uses Messaging Service SID when provided and includes statusCallback if set', async () => {
    const mod = await reload({
      TWILIO_ACCOUNT_SID: 'ACxxx',
      TWILIO_AUTH_TOKEN: 'tok',
      TWILIO_MESSAGING_SERVICE_SID: 'MG123',
      TWILIO_STATUS_CALLBACK_URL: 'https://example.com/callback',
      TWILIO_FROM_NUMBER: '',
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
      messagingServiceSid: 'MG123',
      statusCallback: 'https://example.com/callback',
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
      TWILIO_MESSAGING_SERVICE_SID: '',
      TWILIO_FROM_NUMBER: '+18005551234',
      TWILIO_STATUS_CALLBACK_URL: '',
    });

    const out = await mod.sendSms({
      to: '+14155550123',
      text: 'ping',
    });

    expect(createMock).toHaveBeenCalledWith({
      to: '+14155550123',
      body: 'ping',
      from: '+18005551234',
    });

    expect(out).toEqual({
      ok: true,
      provider: 'twilio',
      messageSid: 'SM123',
      clientRef: null,
    });
  });

  test('throws when neither Messaging Service SID nor FROM number is set', async () => {
    const mod = await reload({
      TWILIO_ACCOUNT_SID: 'ACxxx',
      TWILIO_AUTH_TOKEN: 'tok',
      TWILIO_MESSAGING_SERVICE_SID: '',
      TWILIO_FROM_NUMBER: '',
      TWILIO_STATUS_CALLBACK_URL: '',
    });

    await expect(
      mod.sendSms({ to: '+19998887777', text: 'no from nor msid' })
    ).rejects.toThrow(
      'Twilio SMS requires TWILIO_MESSAGING_SERVICE_SID or TWILIO_FROM_NUMBER'
    );

    expect(createMock).not.toHaveBeenCalled();
  });
});

describe('twilio purchaseNumber()', () => {
  test('assigns the shared inbound Voice TwiML App', async () => {
    const inboundVoiceAppSid =
      'AP11111111111111111111111111111111';

    const mod = await reload({
      TWILIO_ACCOUNT_SID: 'ACxxx',
      TWILIO_AUTH_TOKEN: 'tok',
      TWILIO_INBOUND_VOICE_APP_SID:
        inboundVoiceAppSid,
      TWILIO_MESSAGING_SERVICE_SID:
        'MG11111111111111111111111111111111',
      TWILIO_WEBHOOK_BASE_URL:
        'https://api.chatforia.com/api',
    });

    const result = await mod.purchaseNumber({
      phoneNumber: '+15551234567',
    });

    expect(incomingNumberCreateMock).toHaveBeenCalledWith({
      phoneNumber: '+15551234567',
      smsUrl:
        'https://api.chatforia.com/api/webhooks/sms/twilio',
      smsMethod: 'POST',
      voiceApplicationSid:
        inboundVoiceAppSid,
    });

    expect(
      messagingServicePhoneNumberCreateMock
    ).toHaveBeenCalledWith({
      phoneNumberSid: 'PN123',
    });

    expect(result).toMatchObject({
      ok: true,
      messagingServiceAttached: true,
      sid: 'PN123',
      e164: '+15551234567',
      isoCountry: 'US',
    });
  });
});
