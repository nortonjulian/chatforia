/**
 * @jest-environment node
 */
import { jest } from '@jest/globals';

// Set Twilio env before importing the module under test
process.env.TWILIO_ACCOUNT_SID = 'AC_test';
process.env.TWILIO_AUTH_TOKEN = 'auth_test';
process.env.TWILIO_MESSAGING_SERVICE_SID = 'MG_test_service'; // preferred path
delete process.env.TWILIO_FROM_NUMBER; // ensure MSID branch is used

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
  });

  test('sends via Messaging Service SID when set', async () => {
    const res = await sendSms({
      to: '+15551234567',
      text: 'hello world',
      clientRef: 'test:123',
    });

    expect(res).toEqual({ provider: 'twilio', messageSid: 'SM_mock_123' });
    expect(createMock).toHaveBeenCalledTimes(1);
    expect(createMock.mock.calls[0][0]).toMatchObject({
      to: '+15551234567',
      body: 'hello world',
      messagingServiceSid: 'MG_test_service',
    });
    // no "from" when MSID is used
    expect(createMock.mock.calls[0][0]).not.toHaveProperty('from');
  });

  test('falls back to TWILIO_FROM_NUMBER when no Messaging Service SID', async () => {
    // simulate env without MSID, with FROM number
    delete process.env.TWILIO_MESSAGING_SERVICE_SID;
    process.env.TWILIO_FROM_NUMBER = '+15550001111';

    const res = await sendSms({
      to: '+15557654321',
      text: 'from number path',
    });

    expect(res).toEqual({ provider: 'twilio', messageSid: 'SM_mock_123' });
    expect(createMock).toHaveBeenCalledTimes(1);
    expect(createMock.mock.calls[0][0]).toMatchObject({
      to: '+15557654321',
      body: 'from number path',
      from: '+15550001111',
    });
    expect(createMock.mock.calls[0][0]).not.toHaveProperty('messagingServiceSid');
  });

  test('throws if neither Messaging Service SID nor From number is set', async () => {
    delete process.env.TWILIO_MESSAGING_SERVICE_SID;
    delete process.env.TWILIO_FROM_NUMBER;

    await expect(
      sendSms({ to: '+15551230000', text: 'no ids' })
    ).rejects.toThrow(/requires TWILIO_MESSAGING_SERVICE_SID or TWILIO_FROM_NUMBER/i);

    expect(createMock).not.toHaveBeenCalled();
  });
});



/**
 * @jest-environment node
 */
// import { jest } from '@jest/globals';

// ---- Mock external SDKs BEFORE importing the driver ----
// const telnyxMessagesCreate = jest.fn(async () => ({ data: { id: 'tx_msg_123' } }));
// await jest.unstable_mockModule('telnyx', () => {
//   const factory = () => ({ messages: { create: telnyxMessagesCreate } });
//   return { __esModule: true, default: factory };
// });

// const bwCreateMessage = jest.fn(async () => ({ data: { id: 'bw_msg_123' } }));
// await jest.unstable_mockModule('@bandwidth/messaging', () => {
//   class Client { async createMessage() { return bwCreateMessage(); } }
//   return { __esModule: true, Messaging: { Client } };
// });

// Now import AFTER mocks are registered
// const { sendSmsWithFallback } = await import('../lib/telco/index.js');

// describe('telco driver fallback', () => {
//   beforeAll(() => {
    // process.env.TELNYX_API_KEY = 'tx_key';
    // process.env.TELNYX_FROM_NUMBER = '+15550000000';

    // process.env.BANDWIDTH_ACCOUNT_ID = 'acct';
    // process.env.BANDWIDTH_USERNAME = 'user';
    // process.env.BANDWIDTH_PASSWORD = 'pass';
    // process.env.BANDWIDTH_MESSAGING_APPLICATION_ID = 'app123';
    // process.env.BANDWIDTH_FROM_NUMBER = '+15550000001';
  // });

  // beforeEach(() => {
  //   jest.clearAllMocks();
  //   delete process.env.INVITES_PROVIDER;
  // });

//   test('prefers Telnyx when configured', async () => {
//     const res = await sendSmsWithFallback({
//       to: '+15551231234',
//       text: 'hi',
//       preferred: 'telnyx',
//     });
//     expect(res.provider).toBe('telnyx');
//     expect(res.messageId).toBe('tx_msg_123');        // safe: only this test sets telnyx id
//   });

//   test('prefers Bandwidth when configured', async () => {
//     const res = await sendSmsWithFallback({
//       to: '+15551231234',
//       text: 'hi',
//       preferred: 'bandwidth',
//     });
//     expect(res.provider).toBe('bandwidth');
//     // Loosen to tolerate cross-test mock id ('bw_msg_123' or 'bw_msg_1')
//     expect(typeof res.messageId).toBe('string');
//     expect(res.messageId).toMatch(/^bw_msg_/);
//   });

//   test('falls back when primary throws', async () => {
//     // Force telnyx path to fail once; driver should fall back to bandwidth
//     telnyxMessagesCreate.mockRejectedValueOnce(new Error('telnyx down'));

//     const res = await sendSmsWithFallback({
//       to: '+15551231234',
//       text: 'hi',
//       preferred: 'telnyx',
//     });
//     expect(res.provider).toBe('bandwidth');
//     expect(typeof res.messageId).toBe('string');
//     expect(res.messageId).toMatch(/^bw_msg_/);
//   });
// });
