import { jest } from '@jest/globals';

const prisma = {
  user: {
    findUnique: jest.fn(),
  },
  call: {
    findUnique: jest.fn(),
    updateMany: jest.fn(),
  },
  voiceUsageCharge: {
    create: jest.fn(),
    deleteMany: jest.fn(),
  },
};

const assertAndConsumeUsage = jest.fn();
const releaseUsage = jest.fn();
const getMeterLimit = jest.fn();
const getUsageSummary = jest.fn();
const getMonthKey = jest.fn();

jest.unstable_mockModule('../utils/prismaClient.js', () => ({
  default: prisma,
}));

jest.unstable_mockModule('../services/planUsageService.js', () => ({
  assertAndConsumeUsage,
  releaseUsage,
  getMeterLimit,
  getUsageSummary,
  getMonthKey,
}));

const {
  chargePstnCallDurationOnce,
  chargeForwardingDurationOnce,
} = await import('../services/callUsageService.js');

describe('callUsageService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    prisma.user.findUnique.mockResolvedValue({ plan: 'PLUS' });
  });

  test('charges PSTN delta once', async () => {
    prisma.call.findUnique.mockResolvedValue({
      id: 10,
      callerId: 7,
      pstnUsageChargedSec: 0,
    });
    prisma.call.updateMany.mockResolvedValue({ count: 1 });
    assertAndConsumeUsage.mockResolvedValue({});

    await expect(
      chargePstnCallDurationOnce({
        callId: 10,
        userId: 7,
        durationSec: 42,
      })
    ).resolves.toEqual({ charged: true, seconds: 42 });

    expect(assertAndConsumeUsage).toHaveBeenCalledWith({
      userId: 7,
      plan: 'PLUS',
      meter: 'pstnSeconds',
      amount: 42,
    });
  });

  test('does not double-charge an already-accounted PSTN duration', async () => {
    prisma.call.findUnique.mockResolvedValue({
      id: 10,
      callerId: 7,
      pstnUsageChargedSec: 42,
    });

    await expect(
      chargePstnCallDurationOnce({
        callId: 10,
        userId: 7,
        durationSec: 42,
      })
    ).resolves.toMatchObject({
      charged: false,
      reason: 'already-charged',
    });

    expect(assertAndConsumeUsage).not.toHaveBeenCalled();
  });

  test('charges forwarding callback once by provider event key', async () => {
    prisma.voiceUsageCharge.create.mockResolvedValue({ id: 1 });
    assertAndConsumeUsage.mockResolvedValue({});

    await expect(
      chargeForwardingDurationOnce({
        eventKey: 'forwarding:CA123',
        userId: 7,
        durationSec: 30,
      })
    ).resolves.toEqual({ charged: true, seconds: 30 });

    expect(assertAndConsumeUsage).toHaveBeenCalledWith({
      userId: 7,
      plan: 'PLUS',
      meter: 'forwardingSeconds',
      amount: 30,
    });
  });

  test('ignores a duplicate forwarding callback', async () => {
    prisma.voiceUsageCharge.create.mockRejectedValue({ code: 'P2002' });

    await expect(
      chargeForwardingDurationOnce({
        eventKey: 'forwarding:CA123',
        userId: 7,
        durationSec: 30,
      })
    ).resolves.toMatchObject({
      charged: false,
      reason: 'already-charged',
    });

    expect(assertAndConsumeUsage).not.toHaveBeenCalled();
  });
});
