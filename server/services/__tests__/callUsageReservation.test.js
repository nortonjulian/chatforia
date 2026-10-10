import { jest } from '@jest/globals';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const prismaPath = path.resolve(__dirname, '../../utils/prismaClient.js');

const tx = {
  voiceUsageCharge: {
    findUnique: jest.fn(),
    create: jest.fn(),
    delete: jest.fn(),
  },
  planUsage: {
    upsert: jest.fn(),
    update: jest.fn(),
  },
  $queryRawUnsafe: jest.fn(),
  $executeRawUnsafe: jest.fn(),
};

const prismaMock = {
  user: {
    findUnique: jest.fn(),
  },
  $transaction: jest.fn(async (fn) => fn(tx)),
};

jest.unstable_mockModule(prismaPath, () => ({
  __esModule: true,
  default: prismaMock,
}));

const {
  reserveRemainingUsage,
  finalizeUsageReservation,
} = await import('../callUsageService.js');

describe('callUsageService reservations', () => {
  beforeEach(() => {
    jest.clearAllMocks();

    prismaMock.user.findUnique.mockResolvedValue({
      plan: 'PLUS',
    });

    tx.voiceUsageCharge.findUnique.mockResolvedValue(null);
    tx.voiceUsageCharge.create.mockResolvedValue({});
    tx.voiceUsageCharge.delete.mockResolvedValue({});
    tx.planUsage.upsert.mockResolvedValue({});
    tx.planUsage.update.mockResolvedValue({});
    tx.$executeRawUnsafe.mockResolvedValue(1);
  });

  test('reserves all remaining PSTN seconds atomically', async () => {
    tx.$queryRawUnsafe.mockResolvedValueOnce([{ used: 5900 }]);

    const result = await reserveRemainingUsage({
      userId: 42,
      meter: 'pstnSeconds',
      reservationId: 'CA123',
      date: new Date('2026-10-08T12:00:00.000Z'),
    });

    expect(result).toMatchObject({
      reserved: true,
      duplicate: false,
      seconds: 100,
      meter: 'pstnSeconds',
      monthKey: '2026-10',
      limit: 6000,
      usedBeforeReservation: 5900,
    });

    expect(tx.planUsage.update).toHaveBeenCalledWith({
      where: {
        userId_monthKey: {
          userId: 42,
          monthKey: '2026-10',
        },
      },
      data: {
        pstnSeconds: 6000,
      },
    });
  });

  test('rejects reservation when no PSTN seconds remain', async () => {
    tx.$queryRawUnsafe.mockResolvedValueOnce([{ used: 6000 }]);

    await expect(
      reserveRemainingUsage({
        userId: 42,
        meter: 'pstnSeconds',
        reservationId: 'CA-full',
        date: new Date('2026-10-08T12:00:00.000Z'),
      }),
    ).rejects.toMatchObject({
      code: 'PLAN_ALLOWANCE_EXCEEDED',
      detail: 'pstnSeconds',
      limit: 6000,
      used: 6000,
      remaining: 0,
    });

    expect(tx.voiceUsageCharge.create).not.toHaveBeenCalled();
  });

  test('finalizes reservation and releases unused seconds', async () => {
    tx.$queryRawUnsafe.mockResolvedValueOnce([
      {
        eventKey: 'reservation:2026-10:pstnSeconds:CA123',
        userId: 42,
        meter: 'pstnSeconds',
        seconds: 100,
      },
    ]);

    const result = await finalizeUsageReservation({
      eventKey: 'reservation:2026-10:pstnSeconds:CA123',
      actualSeconds: 40,
    });

    expect(result).toMatchObject({
      finalized: true,
      duplicate: false,
      reservedSeconds: 100,
      actualSeconds: 40,
      releasedSeconds: 60,
    });

    expect(tx.$executeRawUnsafe).toHaveBeenCalledWith(
      expect.stringContaining('"pstnSeconds"'),
      60,
      42,
      '2026-10',
    );
  });

  test('rejects a reservation key with an unsupported meter', async () => {
    const result = await finalizeUsageReservation({
      eventKey:
        'reservation:2026-10:notARealColumn:CA-malicious',
      actualSeconds: 10,
    });

    expect(result).toEqual({
      finalized: false,
      reason: 'invalid-reservation-key',
    });

    expect(tx.$queryRawUnsafe).not.toHaveBeenCalled();
    expect(tx.$executeRawUnsafe).not.toHaveBeenCalled();
  });

  test('finalization is idempotent after reservation row is gone', async () => {
    tx.$queryRawUnsafe.mockResolvedValueOnce([]);
    tx.voiceUsageCharge.findUnique.mockResolvedValueOnce({
      eventKey:
        'final:reservation:2026-10:forwardingSeconds:CA999',
      userId: 42,
      meter: 'forwardingSeconds',
      seconds: 25,
    });

    const result = await finalizeUsageReservation({
      eventKey:
        'reservation:2026-10:forwardingSeconds:CA999',
      actualSeconds: 25,
    });

    expect(result).toMatchObject({
      finalized: true,
      duplicate: true,
      actualSeconds: 25,
      releasedSeconds: 0,
    });

    expect(tx.$executeRawUnsafe).not.toHaveBeenCalled();
  });
});
