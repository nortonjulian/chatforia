import {
  jest,
  describe,
  test,
  expect,
  beforeEach,
} from '@jest/globals';

let telcoSendSmsMock;

// Mock the telco index module BEFORE importing sms.js
await jest.unstable_mockModule('../../server/lib/telco/index.js', () => {
  telcoSendSmsMock = jest.fn();
  return {
    __esModule: true,
    sendSms: telcoSendSmsMock,
  };
});

// Import the module under test after mocks are in place
const { sendSms } = await import('../../utils/sms.js');

beforeEach(() => {
  jest.clearAllMocks();
});

describe('sendSms util', () => {
  test('delegates to telco sendSms with adapted signature', async () => {
    telcoSendSmsMock.mockResolvedValueOnce({ ok: true, sid: 'SM123' });

    const result = await sendSms('+13035550123', 'Hello, Chatforia!');

    expect(telcoSendSmsMock).toHaveBeenCalledTimes(1);
    expect(telcoSendSmsMock).toHaveBeenCalledWith({
      to: '+13035550123',
      text: 'Hello, Chatforia!',
    });

    expect(result).toEqual({ ok: true, sid: 'SM123' });
  });

  test('propagates errors from telco sendSms', async () => {
    const err = new Error('provider failure');
    telcoSendSmsMock.mockRejectedValueOnce(err);

    await expect(
      sendSms('+13035550123', 'This will fail'),
    ).rejects.toThrow('provider failure');

    expect(telcoSendSmsMock).toHaveBeenCalledTimes(1);
  });
});
