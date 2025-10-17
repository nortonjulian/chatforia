/**
 * @jest-environment node
 */
import { jest } from '@jest/globals';

// Create plain Jest fns we can assert against
const bwCreateMessage = jest.fn(async () => ({ data: { id: 'bw_msg_1' } }));
const searchLocalAvailableNumbers = jest.fn(async () => ({
  data: { telephoneNumberList: { telephoneNumber: ['+15555551234'] } },
}));
const createOrder = jest.fn(async () => ({ data: { order: { id: 'bw_order_1' } } }));
const createDisconnectTelephoneNumberOrder = jest.fn(async () => ({}));

// Inject virtual SDKs via globals BEFORE importing the adapter
globalThis.__BW_MESSAGING = {
  Messaging: {
    Client: class {
      async createMessage(/* accountId, body */) {
        return bwCreateMessage();
      }
    },
  },
};

globalThis.__BW_NUMBERS = {
  Numbers: {
    Client: class {
      async searchLocalAvailableNumbers(/* accountId, params */) {
        return searchLocalAvailableNumbers();
      }
      async createOrder(/* accountId, payload */) {
        return createOrder();
      }
      async createDisconnectTelephoneNumberOrder(/* accountId, payload */) {
        return createDisconnectTelephoneNumberOrder();
      }
    },
  },
};

// Now import the real adapter (it will use the globals above)
const BandwidthProvider = (await import('../../lib/telco/legacy/bandwidth.js')).default;

describe('BandwidthProvider', () => {
  beforeAll(() => {
    process.env.BANDWIDTH_ACCOUNT_ID = 'acct';
    process.env.BANDWIDTH_USERNAME = 'user';
    process.env.BANDWIDTH_PASSWORD = 'pass';
    process.env.BANDWIDTH_FROM_NUMBER = '+15550000000';
    process.env.BANDWIDTH_APPLICATION_ID = 'app_1'; // or BANDWIDTH_MESSAGING_APPLICATION_ID
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('sendSms works', async () => {
    const res = await BandwidthProvider.sendSms({ to: '+15551234567', text: 'yo' });
    expect(res.provider).toBe('bandwidth');
    expect(res.messageId).toBe('bw_msg_1');
    expect(bwCreateMessage).toHaveBeenCalledTimes(1);
  });

  test('availability maps results', async () => {
    const res = await BandwidthProvider.checkNumberAvailability({ areaCode: '303', limit: 1 });
    expect(res[0].number).toBe('+15555551234');
    expect(searchLocalAvailableNumbers).toHaveBeenCalledTimes(1);
  });

  test('purchase & release', async () => {
    const order = await BandwidthProvider.purchaseNumber('+15555551234');
    expect(order.id).toBe('bw_order_1');
    await expect(BandwidthProvider.releaseNumber('+15555551234')).resolves.toBeUndefined();
    expect(createOrder).toHaveBeenCalledTimes(1);
    expect(createDisconnectTelephoneNumberOrder).toHaveBeenCalledTimes(1);
  });
});