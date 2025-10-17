/**
 * @jest-environment node
 */
import { jest } from '@jest/globals';

// Mock fetch BEFORE importing the provider
const mockFetch = jest.fn(async (url, opts) => {
  const u = String(url);
  // /messages
  if (u.includes('/messages') && opts?.method === 'POST') {
    return {
      ok: true,
      json: async () => ({ data: { id: 'msg_123' } }),
      text: async () => '',
      status: 200,
      statusText: 'OK',
    };
  }
  // /available_phone_numbers
  if (u.includes('/available_phone_numbers')) {
    return {
      ok: true,
      json: async () => ({
        data: [{ phone_number: '+15555550123', locality: 'Denver' }],
      }),
      text: async () => '',
      status: 200,
      statusText: 'OK',
    };
  }
  // /number_orders
  if (u.includes('/number_orders') && opts?.method === 'POST') {
    return {
      ok: true,
      json: async () => ({ data: { id: 'order_1' } }),
      text: async () => '',
      status: 200,
      statusText: 'OK',
    };
  }
  // /phone_numbers/{...} DELETE
  if (u.includes('/phone_numbers/') && opts?.method === 'DELETE') {
    return {
      ok: true,
      json: async () => ({}),
      text: async () => '',
      status: 200,
      statusText: 'OK',
    };
  }

  // default: not found
  return {
    ok: false,
    json: async () => ({}),
    text: async () => 'not found',
    status: 404,
    statusText: 'Not Found',
  };
});
global.fetch = mockFetch;

import TelnyxProvider from '../../lib/telco/legacy/telnyx.js';

describe('TelnyxProvider', () => {
  beforeAll(() => {
    process.env.TELNYX_API_KEY = 'test_key';
    process.env.TELNYX_MESSAGING_PROFILE_ID = 'mp_123';
    process.env.TELNYX_FROM_NUMBER = '+15550000000';
  });

  test('sendSms works', async () => {
    const res = await TelnyxProvider.sendSms({ to: '+15551231234', text: 'hello', clientRef: 'ref1' });
    expect(res.provider).toBe('telnyx');
    expect(res.messageId).toBe('msg_123');
  });

  test('availability list maps results', async () => {
    const res = await TelnyxProvider.checkNumberAvailability({ areaCode: '303', limit: 1 });
    expect(res[0]).toEqual({ number: '+15555550123', region: 'Denver' });
  });

  test('purchase & release', async () => {
    const order = await TelnyxProvider.purchaseNumber('+15555550123');
    expect(order.id).toBe('order_1');
    await expect(TelnyxProvider.releaseNumber('+15555550123')).resolves.toBeUndefined();
  });
});