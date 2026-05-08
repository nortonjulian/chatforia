import { jest, describe, it, expect, beforeEach } from '@jest/globals';

const prisma = {
  user: {
    findUnique: jest.fn(),
  },
  subscriber: {
    findFirst: jest.fn(),
  },
  portRequest: {
    create: jest.fn(),
    findMany: jest.fn(),
    findUnique: jest.fn(),
    update: jest.fn(),
  },
};

await jest.unstable_mockModule('../utils/prismaClient.js', () => ({
  __esModule: true,
  default: prisma,
}));

const {
  createPortRequestForUser,
  getUserPortRequests,
  getUserPortRequestById,
  updatePortStatus,
} = await import('../portingService.js');

const mockWirelessUser = {
  id: 1,
  email: 'user@example.com',
};

const mockFreeUser = {
  id: 2,
  email: 'free@example.com',
};

describe('portingService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('createPortRequestForUser', () => {
    const baseInput = {
      phoneNumber: '+1 555 123 4567',
      carrier: 'Verizon',
      accountNumber: 'ACC-123',
      pin: '1234',
      fullName: 'Jane Doe',
      addressLine1: '123 Main St',
      addressLine2: '',
      city: 'Denver',
      state: 'CO',
      postalCode: '80202',
    };

    it('throws if user has no wireless entitlement', async () => {
      prisma.user.findUnique.mockResolvedValueOnce({
        id: 2,
        role: 'USER',
        plan: 'FREE',
        subscriptionStatus: 'INACTIVE',
        subscriptionEndsAt: null,
      });

      prisma.subscriber.findFirst.mockResolvedValueOnce(null);

      await expect(
        createPortRequestForUser(mockFreeUser, baseInput)
      ).rejects.toThrow(
        'A Chatforia Wireless plan is required to port a number.'
      );

      expect(prisma.user.findUnique).toHaveBeenCalledWith({
        where: { id: 2 },
        select: {
          id: true,
          role: true,
          plan: true,
          subscriptionStatus: true,
          subscriptionEndsAt: true,
        },
      });

      expect(prisma.subscriber.findFirst).toHaveBeenCalledWith({
        where: { userId: 2 },
        select: {
          id: true,
          status: true,
          provider: true,
        },
      });

      expect(prisma.portRequest.create).not.toHaveBeenCalled();
    });

    it('creates a port request when user has active WIRELESS subscription', async () => {
      prisma.user.findUnique.mockResolvedValueOnce({
        id: 1,
        role: 'USER',
        plan: 'WIRELESS',
        subscriptionStatus: 'ACTIVE',
        subscriptionEndsAt: new Date(Date.now() + 1000 * 60 * 60 * 24),
      });

      prisma.subscriber.findFirst.mockResolvedValueOnce(null);

      const mockCreated = {
        id: 101,
        userId: 1,
        phoneNumber: baseInput.phoneNumber,
        status: 'PENDING',
      };

      prisma.portRequest.create.mockResolvedValueOnce(mockCreated);

      const result = await createPortRequestForUser(
        mockWirelessUser,
        baseInput
      );

      expect(result).toBe(mockCreated);

      expect(prisma.portRequest.create).toHaveBeenCalledWith({
        data: {
          userId: 1,
          phoneNumber: baseInput.phoneNumber,
          carrier: baseInput.carrier,
          accountNumber: baseInput.accountNumber,
          pin: baseInput.pin,
          fullName: baseInput.fullName,
          addressLine1: baseInput.addressLine1,
          addressLine2: baseInput.addressLine2,
          city: baseInput.city,
          state: baseInput.state,
          postalCode: baseInput.postalCode,
          country: 'US',
          status: 'PENDING',
        },
      });
    });

    it('creates a port request when user has active subscriber entitlement', async () => {
      prisma.user.findUnique.mockResolvedValueOnce({
        id: 1,
        role: 'USER',
        plan: 'FREE',
        subscriptionStatus: 'INACTIVE',
        subscriptionEndsAt: null,
      });

      prisma.subscriber.findFirst.mockResolvedValueOnce({
        id: 77,
        status: 'ACTIVE',
        provider: 'telna',
      });

      const mockCreated = {
        id: 102,
        userId: 1,
        phoneNumber: baseInput.phoneNumber,
        status: 'PENDING',
      };

      prisma.portRequest.create.mockResolvedValueOnce(mockCreated);

      const result = await createPortRequestForUser(
        mockWirelessUser,
        baseInput
      );

      expect(result).toBe(mockCreated);
      expect(prisma.portRequest.create).toHaveBeenCalledTimes(1);
    });

    it('creates a port request when user is ADMIN', async () => {
      prisma.user.findUnique.mockResolvedValueOnce({
        id: 1,
        role: 'ADMIN',
        plan: 'FREE',
        subscriptionStatus: 'INACTIVE',
        subscriptionEndsAt: null,
      });

      prisma.subscriber.findFirst.mockResolvedValueOnce(null);

      const mockCreated = {
        id: 103,
        userId: 1,
        phoneNumber: baseInput.phoneNumber,
        status: 'PENDING',
      };

      prisma.portRequest.create.mockResolvedValueOnce(mockCreated);

      const result = await createPortRequestForUser(
        mockWirelessUser,
        baseInput
      );

      expect(result).toBe(mockCreated);
      expect(prisma.portRequest.create).toHaveBeenCalledTimes(1);
    });
  });

  describe('getUserPortRequests', () => {
    it('returns list of port requests for user with correct query', async () => {
      const mockList = [
        { id: 1, userId: 1 },
        { id: 2, userId: 1 },
      ];

      prisma.portRequest.findMany.mockResolvedValueOnce(mockList);

      const result = await getUserPortRequests('1');

      expect(prisma.portRequest.findMany).toHaveBeenCalledWith({
        where: { userId: 1 },
        orderBy: { createdAt: 'desc' },
      });

      expect(result).toBe(mockList);
    });
  });

  describe('getUserPortRequestById', () => {
    it('returns request when userId matches', async () => {
      const mockReq = {
        id: 1,
        userId: 1,
        phoneNumber: '+1 555 123 4567',
      };

      prisma.portRequest.findUnique.mockResolvedValueOnce(mockReq);

      const result = await getUserPortRequestById('1', '1');

      expect(prisma.portRequest.findUnique).toHaveBeenCalledWith({
        where: { id: 1 },
      });

      expect(result).toBe(mockReq);
    });

    it('returns null when request does not exist', async () => {
      prisma.portRequest.findUnique.mockResolvedValueOnce(null);

      const result = await getUserPortRequestById('1', '999');

      expect(prisma.portRequest.findUnique).toHaveBeenCalledWith({
        where: { id: 999 },
      });

      expect(result).toBeNull();
    });

    it('returns null when request belongs to a different user', async () => {
      const mockReq = {
        id: 1,
        userId: 999,
      };

      prisma.portRequest.findUnique.mockResolvedValueOnce(mockReq);

      const result = await getUserPortRequestById('1', '1');

      expect(prisma.portRequest.findUnique).toHaveBeenCalledWith({
        where: { id: 1 },
      });

      expect(result).toBeNull();
    });
  });

  describe('updatePortStatus', () => {
    it('updates status and timestamps correctly', async () => {
      const scheduledAt = new Date('2030-01-01T10:00:00.000Z');
      const completedAt = new Date('2030-01-02T10:00:00.000Z');

      const mockUpdated = {
        id: 123,
        status: 'COMPLETED',
      };

      prisma.portRequest.update.mockResolvedValueOnce(mockUpdated);

      const result = await updatePortStatus(123, {
        status: 'COMPLETED',
        statusReason: 'Done',
        scheduledAt,
        completedAt,
      });

      expect(prisma.portRequest.update).toHaveBeenCalledWith({
        where: { id: 123 },
        data: {
          status: 'COMPLETED',
          statusReason: 'Done',
          scheduledAt,
          completedAt,
        },
      });

      expect(result).toBe(mockUpdated);
    });

    it('passes undefined for optional dates when not provided', async () => {
      prisma.portRequest.update.mockResolvedValueOnce({ id: 456 });

      await updatePortStatus(456, {
        status: 'FAILED',
        statusReason: 'Error',
        scheduledAt: undefined,
        completedAt: undefined,
      });

      expect(prisma.portRequest.update).toHaveBeenCalledWith({
        where: { id: 456 },
        data: {
          status: 'FAILED',
          statusReason: 'Error',
          scheduledAt: undefined,
          completedAt: undefined,
        },
      });
    });
  });
});