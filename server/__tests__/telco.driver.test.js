/**
 * @jest-environment node
 */
import { jest } from '@jest/globals';

// Set Twilio env before importing the module under test
process.env.TWILIO_ACCOUNT_SID = 'AC_test';
process.env.TWILIO_AUTH_TOKEN = 'auth_test';
process.env.TWILIO_MESSAGING_SERVICE_SID = 'MG_test_service';
delete process.env.TWILIO_FROM_NUMBER;

// ---- Mock external SDK BEFORE importing the driver ----
const createMock = jest.fn(async (_params) => ({ sid: 'SM_mock_123' }));

await jest.unstable_mockModule('twilio', () => {
  const factory = () => ({
    messages: { create: createMock },
  });

  return { __esModule: true, default: factory };
});

// Now import AFTER mocks are registered
const { sendSms } = await import('../lib/telco/index.js');

describe('telco driver (Twilio only)', () => {
  beforeEach(() => {
    jest.clearAllMocks();

    process.env.TWILIO_ACCOUNT_SID = 'AC_test';
    process.env.TWILIO_AUTH_TOKEN = 'auth_test';
    process.env.TWILIO_MESSAGING_SERVICE_SID = 'MG_test_service';
    delete process.env.TWILIO_FROM_NUMBER;
  });

  test('sends via Messaging Service SID when set', async () => {
    const res = await sendSms({
      to: '+15551234567',
      text: 'hello world',
      clientRef: 'test:123',
    });

    expect(res).toEqual({
      ok: true,
      provider: 'twilio',
      messageSid: 'SM_mock_123',
      clientRef: 'test:123',
    });

    expect(createMock).toHaveBeenCalledTimes(1);
    expect(createMock.mock.calls[0][0]).toMatchObject({
      to: '+15551234567',
      body: 'hello world',
      messagingServiceSid: 'MG_test_service',
    });

    expect(createMock.mock.calls[0][0]).not.toHaveProperty('from');
  });

  test('falls back to TWILIO_FROM_NUMBER when no Messaging Service SID', async () => {
    delete process.env.TWILIO_MESSAGING_SERVICE_SID;
    process.env.TWILIO_FROM_NUMBER = '+15550001111';

    const res = await sendSms({
      to: '+15557654321',
      text: 'from number path',
    });

    expect(res).toEqual({
      ok: true,
      provider: 'twilio',
      messageSid: 'SM_mock_123',
      clientRef: null,
    });

    expect(createMock).toHaveBeenCalledTimes(1);
    expect(createMock.mock.calls[0][0]).toMatchObject({
      to: '+15557654321',
      body: 'from number path',
      from: '+15550001111',
    });

    expect(createMock.mock.calls[0][0]).not.toHaveProperty(
      'messagingServiceSid'
    );
  });

  test('returns provider_error if neither Messaging Service SID nor From number is set', async () => {
    delete process.env.TWILIO_MESSAGING_SERVICE_SID;
    delete process.env.TWILIO_FROM_NUMBER;

    const res = await sendSms({
      to: '+15551230000',
      text: 'no ids',
    });

    expect(res).toEqual({
      ok: false,
      reason: 'provider_error',
      detail: 'Twilio SMS requires TWILIO_MESSAGING_SERVICE_SID or TWILIO_FROM_NUMBER',
    });

    expect(createMock).not.toHaveBeenCalled();
  });
});