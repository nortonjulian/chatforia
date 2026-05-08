import {
  jest,
  describe,
  test,
  expect,
  beforeEach,
  afterAll,
} from '@jest/globals';

const ORIGINAL_ENV = { ...process.env };

let telcoSendSmsMock;

// From server/utils/__tests__/sms.test.js to server/lib/telco/index.js
await jest.unstable_mockModule('../../lib/telco/index.js', () => {
  telcoSendSmsMock = jest.fn();

  return {
    __esModule: true,
    sendSms: telcoSendSmsMock,
  };
});

// Import after mock
const { sendSms } = await import('../sms.js');

beforeEach(() => {
  jest.clearAllMocks();

  process.env = {
    ...ORIGINAL_ENV,
    TWILIO_FROM_NUMBER: '+15550001111',
  };

  delete process.env.TWILIO_PHONE_NUMBER;
});

afterAll(() => {
  process.env = ORIGINAL_ENV;
});

describe('sendSms util', () => {
  test('delegates to telco sendSms with adapted signature', async () => {
    telcoSendSmsMock.mockResolvedValueOnce({ ok: true, sid: 'SM123' });

    const result = await sendSms('+13035550123', 'Hello, Chatforia!');

    expect(telcoSendSmsMock).toHaveBeenCalledTimes(1);
    expect(telcoSendSmsMock).toHaveBeenCalledWith({
      to: '+13035550123',
      text: 'Hello, Chatforia!',
      from: '+15550001111',
    });

    expect(result).toEqual({ ok: true, sid: 'SM123' });
  });

  test('propagates errors from telco sendSms', async () => {
    const err = new Error('provider failure');
    telcoSendSmsMock.mockRejectedValueOnce(err);

    await expect(
      sendSms('+13035550123', 'This will fail')
    ).rejects.toThrow('provider failure');

    expect(telcoSendSmsMock).toHaveBeenCalledTimes(1);
  });

  test('throws when destination phone is invalid', async () => {
    await expect(sendSms('not-a-phone', 'hello')).rejects.toThrow(
      'Invalid destination phone'
    );

    expect(telcoSendSmsMock).not.toHaveBeenCalled();
  });

  test('throws when no system sender number is configured', async () => {
    delete process.env.TWILIO_FROM_NUMBER;
    delete process.env.TWILIO_PHONE_NUMBER;

    await expect(
      sendSms('+13035550123', 'Hello')
    ).rejects.toThrow(
      'Missing TWILIO_FROM_NUMBER (or TWILIO_PHONE_NUMBER) for system SMS'
    );

    expect(telcoSendSmsMock).not.toHaveBeenCalled();
  });

  test('falls back to TWILIO_PHONE_NUMBER when TWILIO_FROM_NUMBER is missing', async () => {
    delete process.env.TWILIO_FROM_NUMBER;
    process.env.TWILIO_PHONE_NUMBER = '+15552223333';

    telcoSendSmsMock.mockResolvedValueOnce({ ok: true, sid: 'SM456' });

    const result = await sendSms('+13035550123', 'Fallback sender');

    expect(telcoSendSmsMock).toHaveBeenCalledWith({
      to: '+13035550123',
      text: 'Fallback sender',
      from: '+15552223333',
    });

    expect(result).toEqual({ ok: true, sid: 'SM456' });
  });
});