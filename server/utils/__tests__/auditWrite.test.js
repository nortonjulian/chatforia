import { jest } from '@jest/globals';

// ---- Prisma mock ----
const mockPrisma = {
  auditLog: {
    create: jest.fn(),
  },
};

// IMPORTANT: use the SAME specifier as in auditWrite.js:
// import prisma from '../utils/prismaClient.js';
await jest.unstable_mockModule('../utils/prismaClient.js', () => ({
  __esModule: true,
  default: mockPrisma,
}));

// ---- Import function under test ----
const { writeAudit } = await import('../auditWrite.js');

describe('writeAudit', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('writes audit log with stringified resourceId and default values', async () => {
    await writeAudit({
      actorId: 123,
      action: 'LOGIN',
      resource: 'user',
      resourceId: 987, // should be stringified
      // status, ip, userAgent, metadata omitted (use defaults)
    });

    expect(mockPrisma.auditLog.create).toHaveBeenCalledTimes(1);
    expect(mockPrisma.auditLog.create).toHaveBeenCalledWith({
      data: {
        actorId: 123,
        action: 'LOGIN',
        resource: 'user',
        resourceId: '987', // stringified
        status: 200,
        ip: null,
        userAgent: null,
        metadata: null,
      },
    });
  });

  it('sets resourceId to null when missing or undefined', async () => {
    await writeAudit({
      actorId: 1,
      action: 'UPDATE',
      resource: 'settings',
      // no resourceId
      status: 204,
      ip: '127.0.0.1',
      userAgent: 'test-agent',
      metadata: { foo: 'bar' },
    });

    expect(mockPrisma.auditLog.create).toHaveBeenCalledWith({
      data: {
        actorId: 1,
        action: 'UPDATE',
        resource: 'settings',
        resourceId: null,
        status: 204,
        ip: '127.0.0.1',
        userAgent: 'test-agent',
        metadata: { foo: 'bar' },
      },
    });
  });

  it('swallows errors thrown by prisma.auditLog.create', async () => {
    mockPrisma.auditLog.create.mockRejectedValueOnce(
      new Error('DB is on vacation'),
    );

    await expect(
      writeAudit({
        actorId: 5,
        action: 'DELETE',
        resource: 'message',
        resourceId: 42,
      }),
    ).resolves.toBeUndefined(); // no error should bubble up

    expect(mockPrisma.auditLog.create).toHaveBeenCalledTimes(1);
  });
});
