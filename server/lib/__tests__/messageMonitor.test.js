import { jest } from '@jest/globals';
import { handleStatusUpdate } from './messageMonitor.js';

// Mock logger and prisma *before* importing their default exports
jest.unstable_mockModule('../../utils/logger.js', () => ({
  __esModule: true,
  default: {
    info: jest.fn(),
    warn: jest.fn(),
  },
}));

jest.unstable_mockModule('../../utils/prismaClient.js', () => ({
  __esModule: true,
  default: {
    outboundMessage: {
      updateMany: jest.fn(),
    },
  },
}));

// Re-import the mocked modules
const loggerModule = await import('../../utils/logger.js');
const prismaModule = await import('../../utils/prismaClient.js');

const logger = loggerModule.default;
const prisma = prismaModule.default;

describe('handleStatusUpdate', () => {
  const fixedNow = new Date('2025-01-01T00:00:00.000Z');

  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(fixedNow);
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('uses MessageSid/MessageStatus and persists delivery status', async () => {
    prisma.outboundMessage.updateMany.mockResolvedValueOnce({ count: 1 });

    const payload = {
      MessageSid: 'SM123',
      MessageStatus: 'delivered',
      To: '+15551234567',
      From: '+15557654321',
      ErrorCode: '30005',
      ErrorMessage: 'Unknown destination',
      SmsSid: undefined,
      SmsStatus: undefined,
    };

    await handleStatusUpdate(payload);

    // Logs info
    expect(logger.info).toHaveBeenCalledTimes(1);
    const [infoArgObj, infoMsg] = logger.info.mock.calls[0];

    expect(infoMsg).toBe('[Twilio Status Update]');
    expect(infoArgObj).toMatchObject({
      sid: 'SM123',
      To: payload.To,
      From: payload.From,
      status: 'delivered',
      ErrorCode: '30005',
      ErrorMessage: 'Unknown destination',
    });

    // Writes to DB
    expect(prisma.outboundMessage.updateMany).toHaveBeenCalledTimes(1);
    expect(prisma.outboundMessage.updateMany).toHaveBeenCalledWith({
      where: { providerMessageId: 'SM123' },
      data: {
        deliveryStatus: 'delivered',
        deliveryErrorCode: '30005',
        deliveryErrorMessage: 'Unknown destination',
        deliveryUpdatedAt: fixedNow,
      },
    });
  });

  it('falls back to SmsSid/SmsStatus when MessageSid/MessageStatus are missing', async () => {
    prisma.outboundMessage.updateMany.mockResolvedValueOnce({ count: 0 });

    const payload = {
      MessageSid: undefined,
      MessageStatus: undefined,
      SmsSid: 'SM999',
      SmsStatus: 'failed',
      To: '+15550000001',
      From: '+15550000002',
      ErrorCode: undefined,
      ErrorMessage: undefined,
    };

    await handleStatusUpdate(payload);

    expect(logger.info).toHaveBeenCalledTimes(1);
    const [infoArgObj] = logger.info.mock.calls[0];

    expect(infoArgObj).toMatchObject({
      sid: 'SM999',
      status: 'failed',
      To: payload.To,
      From: payload.From,
      ErrorCode: undefined,
      ErrorMessage: undefined,
    });

    expect(prisma.outboundMessage.updateMany).toHaveBeenCalledWith({
      where: { providerMessageId: 'SM999' },
      data: {
        deliveryStatus: 'failed',
        deliveryErrorCode: null,
        deliveryErrorMessage: null,
        deliveryUpdatedAt: fixedNow,
      },
    });
  });

  it('logs a warning if persisting delivery status fails but does not throw', async () => {
    const error = new Error('DB error');
    prisma.outboundMessage.updateMany.mockRejectedValueOnce(error);

    const payload = {
      MessageSid: 'SMERR',
      MessageStatus: 'undelivered',
      To: '+15551112222',
      From: '+15553334444',
      ErrorCode: '30006',
      ErrorMessage: 'Landline or unreachable',
      SmsSid: undefined,
      SmsStatus: undefined,
    };

    await expect(handleStatusUpdate(payload)).resolves.toBeUndefined();

    // Still logs info
    expect(logger.info).toHaveBeenCalledTimes(1);

    // Logs warn with error and sid
    expect(logger.warn).toHaveBeenCalledTimes(1);
    const [warnArgObj, warnMsg] = logger.warn.mock.calls[0];

    expect(warnMsg).toBe('Failed to persist delivery status');
    expect(warnArgObj.sid).toBe('SMERR');
    expect(warnArgObj.err).toBe(error);
  });
});
