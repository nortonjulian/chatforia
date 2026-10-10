import {
  jest,
  describe,
  test,
  expect,
  beforeEach,
} from '@jest/globals';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const prismaPath = path.resolve(__dirname, '../../utils/prismaClient.js');
const socketBusPath = path.resolve(__dirname, '../socketBus.js');
const callUsagePath = path.resolve(__dirname, '../callUsageService.js');
const hostedUsagePath = path.resolve(
  __dirname,
  '../hostedParticipantUsageService.js',
);

const roomUpdateMock = jest.fn();
const roomsMock = jest.fn(() => ({
  update: roomUpdateMock,
}));

const twilioClientMock = {
  video: {
    v1: {
      rooms: roomsMock,
    },
  },
};

await jest.unstable_mockModule('twilio', () => ({
  __esModule: true,
  default: jest.fn(() => twilioClientMock),
}));

const prismaMock = {
  call: {
    findMany: jest.fn(),
    updateMany: jest.fn(),
  },
};

await jest.unstable_mockModule(prismaPath, () => ({
  __esModule: true,
  default: prismaMock,
}));

const emitToUserMock = jest.fn();

await jest.unstable_mockModule(socketBusPath, () => ({
  emitToUser: emitToUserMock,
}));

const getUsageAvailabilityMock = jest.fn();

await jest.unstable_mockModule(callUsagePath, () => ({
  getUsageAvailability: getUsageAvailabilityMock,
}));

const closeAndChargeHostedParticipantsForCallMock = jest.fn();

await jest.unstable_mockModule(hostedUsagePath, () => ({
  closeAndChargeHostedParticipantsForCall:
    closeAndChargeHostedParticipantsForCallMock,
}));

const {
  activeParticipantSeconds,
  runHostedAllowanceSweep,
} = await import('../hostedAllowanceMonitor.js');

describe('hostedAllowanceMonitor', () => {
  const now = new Date('2026-10-09T00:00:10.000Z');

  beforeEach(() => {
    jest.clearAllMocks();

    process.env.TWILIO_ACCOUNT_SID = 'AC_TEST';
    process.env.TWILIO_API_KEY_SID = 'SK_TEST';
    process.env.TWILIO_API_KEY_SECRET = 'TEST_SECRET';

    prismaMock.call.findMany.mockResolvedValue([]);
    prismaMock.call.updateMany.mockResolvedValue({ count: 1 });
    roomUpdateMock.mockResolvedValue({ sid: 'RM_TEST' });
    closeAndChargeHostedParticipantsForCallMock.mockResolvedValue({
      skipped: false,
      finalizedParticipants: 2,
      chargedSeconds: 10,
    });

    getUsageAvailabilityMock.mockResolvedValue({
      meter: 'hostedParticipantSeconds',
      used: 17990,
      limit: 18000,
      remaining: 10,
    });
  });

  test('sums elapsed seconds for all currently joined participants', () => {
    const result = activeParticipantSeconds([
      {
        status: 'JOINED',
        joinedAt: new Date('2026-10-09T00:00:00.000Z'),
        leftAt: null,
      },
      {
        status: 'JOINED',
        joinedAt: new Date('2026-10-09T00:00:05.000Z'),
        leftAt: null,
      },
    ], now);

    expect(result).toBe(15);
  });

  test('ignores ringing, left, and invalid sessions', () => {
    const result = activeParticipantSeconds([
      {
        status: 'RINGING',
        joinedAt: new Date('2026-10-09T00:00:00.000Z'),
        leftAt: null,
      },
      {
        status: 'JOINED',
        joinedAt: new Date('2026-10-09T00:00:00.000Z'),
        leftAt: new Date('2026-10-09T00:00:03.000Z'),
      },
      {
        status: 'JOINED',
        joinedAt: null,
        leftAt: null,
      },
    ], now);

    expect(result).toBe(0);
  });

  test('rounds active participant time upward to whole seconds', () => {
    const result = activeParticipantSeconds([
      {
        status: 'JOINED',
        joinedAt: new Date('2026-10-09T00:00:09.100Z'),
        leftAt: null,
      },
    ], now);

    expect(result).toBe(1);
  });

  test('ends a hosted video call when aggregate live usage reaches remaining allowance', async () => {
    prismaMock.call.findMany.mockResolvedValueOnce([
      {
        id: 91,
        callerId: 42,
        calleeId: 99,
        mode: 'VIDEO',
        participants: [
          {
            id: 501,
            userId: 42,
            status: 'JOINED',
            joinedAt: new Date('2026-10-09T00:00:05.000Z'),
            leftAt: null,
          },
          {
            id: 502,
            userId: 99,
            status: 'JOINED',
            joinedAt: new Date('2026-10-09T00:00:05.000Z'),
            leftAt: null,
          },
        ],
      },
    ]);

    const result = await runHostedAllowanceSweep({ now });

    expect(result).toEqual({
      skipped: false,
      endedCalls: 1,
      activeCalls: 1,
    });

    expect(getUsageAvailabilityMock).toHaveBeenCalledWith({
      userId: 42,
      meter: 'hostedParticipantSeconds',
      date: now,
    });

    expect(prismaMock.call.updateMany).toHaveBeenCalledWith({
      where: {
        id: 91,
        externalPhone: null,
        status: 'ACTIVE',
      },
      data: {
        status: 'ENDED',
        endedAt: now,
        endReason: 'hosted_allowance_exhausted',
      },
    });

    expect(roomsMock).toHaveBeenCalledWith('call_91');
    expect(roomUpdateMock).toHaveBeenCalledWith({
      status: 'completed',
    });

    expect(
      closeAndChargeHostedParticipantsForCallMock,
    ).toHaveBeenCalledWith({
      callId: 91,
      endedAt: now,
    });

    expect(emitToUserMock).toHaveBeenCalledWith(
      42,
      'call:ended',
      expect.objectContaining({
        callId: 91,
        status: 'ENDED',
        reason: 'hosted_allowance_exhausted',
        code: 'PLAN_ALLOWANCE_EXCEEDED',
        detail: 'hostedParticipantSeconds',
      }),
    );

    expect(emitToUserMock).toHaveBeenCalledWith(
      99,
      'call:ended',
      expect.objectContaining({
        callId: 91,
        status: 'ENDED',
        reason: 'hosted_allowance_exhausted',
      }),
    );

    expect(emitToUserMock).toHaveBeenCalledWith(
      42,
      'video:ended',
      expect.objectContaining({
        callId: 91,
      }),
    );

    expect(emitToUserMock).toHaveBeenCalledWith(
      99,
      'video:ended',
      expect.objectContaining({
        callId: 91,
      }),
    );
  });

  test('does not end a hosted call before the shared allowance boundary', async () => {
    prismaMock.call.findMany.mockResolvedValueOnce([
      {
        id: 92,
        callerId: 42,
        calleeId: 99,
        mode: 'VIDEO',
        participants: [
          {
            id: 503,
            userId: 42,
            status: 'JOINED',
            joinedAt: new Date('2026-10-09T00:00:08.000Z'),
            leftAt: null,
          },
          {
            id: 504,
            userId: 99,
            status: 'JOINED',
            joinedAt: new Date('2026-10-09T00:00:08.000Z'),
            leftAt: null,
          },
        ],
      },
    ]);

    getUsageAvailabilityMock.mockResolvedValueOnce({
      meter: 'hostedParticipantSeconds',
      used: 17990,
      limit: 18000,
      remaining: 10,
    });

    const result = await runHostedAllowanceSweep({ now });

    expect(result).toEqual({
      skipped: false,
      endedCalls: 0,
      activeCalls: 1,
    });

    expect(prismaMock.call.updateMany).not.toHaveBeenCalled();
    expect(roomUpdateMock).not.toHaveBeenCalled();
    expect(
      closeAndChargeHostedParticipantsForCallMock,
    ).not.toHaveBeenCalled();
    expect(emitToUserMock).not.toHaveBeenCalled();
  });
});
