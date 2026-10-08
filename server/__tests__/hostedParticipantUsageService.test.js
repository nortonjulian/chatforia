import { jest } from '@jest/globals';

const prisma = {
  user: {
    findUnique: jest.fn(),
  },
  voiceUsageCharge: {
    create: jest.fn(),
    deleteMany: jest.fn(),
  },
  call: {
    findUnique: jest.fn(),
  },
  callParticipant: {
    updateMany: jest.fn(),
  },
};

const assertAndConsumeUsage = jest.fn();

jest.unstable_mockModule('../utils/prismaClient.js', () => ({
  default: prisma,
}));

jest.unstable_mockModule('../services/planUsageService.js', () => ({
  assertAndConsumeUsage,
}));

const {
  chargeHostedParticipantSessionOnce,
  closeAndChargeHostedParticipantsForCall,
} = await import('../services/hostedParticipantUsageService.js');

describe('hostedParticipantUsageService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    prisma.user.findUnique.mockResolvedValue({ plan: 'PLUS' });
  });

  test('charges participant duration to the call host', async () => {
    prisma.voiceUsageCharge.create.mockResolvedValue({ id: 1 });
    assertAndConsumeUsage.mockResolvedValue({});

    const joinedAt = new Date('2026-10-08T00:00:00.000Z');
    const leftAt = new Date('2026-10-08T00:01:30.000Z');

    await expect(
      chargeHostedParticipantSessionOnce({
        callId: 10,
        participantId: 100,
        participantUserId: 22,
        hostUserId: 7,
        joinedAt,
        leftAt,
      })
    ).resolves.toMatchObject({
      charged: true,
      seconds: 90,
      participantUserId: 22,
    });

    expect(assertAndConsumeUsage).toHaveBeenCalledWith({
      userId: 7,
      plan: 'PLUS',
      meter: 'hostedParticipantSeconds',
      amount: 90,
    });
  });

  test('does not double-charge the same joined session', async () => {
    prisma.voiceUsageCharge.create.mockRejectedValue({ code: 'P2002' });

    await expect(
      chargeHostedParticipantSessionOnce({
        callId: 10,
        participantId: 100,
        participantUserId: 22,
        hostUserId: 7,
        joinedAt: new Date('2026-10-08T00:00:00.000Z'),
        leftAt: new Date('2026-10-08T00:01:00.000Z'),
      })
    ).resolves.toMatchObject({
      charged: false,
      reason: 'already-charged',
    });

    expect(assertAndConsumeUsage).not.toHaveBeenCalled();
  });

  test('skips PSTN calls', async () => {
    prisma.call.findUnique.mockResolvedValue({
      id: 50,
      callerId: 7,
      externalPhone: '+15551234567',
      participants: [],
    });

    await expect(
      closeAndChargeHostedParticipantsForCall({
        callId: 50,
        endedAt: new Date(),
      })
    ).resolves.toEqual({
      skipped: true,
      reason: 'pstn-call',
      chargedSeconds: 0,
    });

    expect(prisma.callParticipant.updateMany).not.toHaveBeenCalled();
    expect(assertAndConsumeUsage).not.toHaveBeenCalled();
  });

  test('finalizes and charges every still-joined app participant', async () => {
    const endedAt = new Date('2026-10-08T00:02:00.000Z');

    prisma.call.findUnique.mockResolvedValue({
      id: 60,
      callerId: 7,
      externalPhone: null,
      participants: [
        {
          id: 601,
          userId: 7,
          joinedAt: new Date('2026-10-08T00:00:00.000Z'),
          leftAt: null,
          status: 'JOINED',
        },
        {
          id: 602,
          userId: 22,
          joinedAt: new Date('2026-10-08T00:00:30.000Z'),
          leftAt: null,
          status: 'JOINED',
        },
      ],
    });

    prisma.callParticipant.updateMany.mockResolvedValue({ count: 1 });
    prisma.voiceUsageCharge.create.mockResolvedValue({ id: 1 });
    assertAndConsumeUsage.mockResolvedValue({});

    const result = await closeAndChargeHostedParticipantsForCall({
      callId: 60,
      endedAt,
    });

    expect(result).toMatchObject({
      skipped: false,
      finalizedParticipants: 2,
      chargedSeconds: 210,
    });

    expect(assertAndConsumeUsage).toHaveBeenCalledTimes(2);
    expect(assertAndConsumeUsage).toHaveBeenNthCalledWith(1, {
      userId: 7,
      plan: 'PLUS',
      meter: 'hostedParticipantSeconds',
      amount: 120,
    });
    expect(assertAndConsumeUsage).toHaveBeenNthCalledWith(2, {
      userId: 7,
      plan: 'PLUS',
      meter: 'hostedParticipantSeconds',
      amount: 90,
    });
  });
});
