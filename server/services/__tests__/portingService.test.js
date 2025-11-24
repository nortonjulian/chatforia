import prisma from '../utils/prismaClient.js';
import Stripe from 'stripe';
import {
  createPortRequestForUser,
  getUserPortRequests,
  getUserPortRequestById,
  updatePortStatus,
} from './portingService.js';

// Mock prisma client
jest.mock('../utils/prismaClient.js', () => ({
  __esModule: true,
  default: {
    portRequest: {
      create: jest.fn(),
      findMany: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
    },
  },
}));

// Mock Stripe constructor + instance
jest.mock('stripe', () => {
  const mockStripe = jest.fn(() => ({
    subscriptions: {
      list: jest.fn(),
    },
  }));
  return mockStripe;
});

const mockUserWithCustomer = {
  id: 'user_1',
  email: 'user@example.com',
  stripeCustomerId: 'cus_123',
};

const mockUserWithoutCustomer = {
  id: 'user_2',
  email: 'no-customer@example.com',
  stripeCustomerId: null,
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
      // no country => should default to 'US'
    };

    it('throws if user has no stripeCustomerId', async () => {
      // checkUserHasWirelessPlan should short-circuit without calling Stripe
      await expect(
        createPortRequestForUser(mockUserWithoutCustomer, baseInput)
      ).rejects.toThrow(
        'A Chatforia Wireless plan is required to port a number.'
      );

      // Should NOT call prisma or stripe
      const stripeInstance = Stripe.mock.instances[0];
      if (stripeInstance) {
        expect(stripeInstance.subscriptions.list).not.toHaveBeenCalled();
      }
      expect(prisma.portRequest.create).not.toHaveBeenCalled();
    });

    it('throws if user has Stripe customer but no wireless plan subscription', async () => {
      const stripeInstance = Stripe.mock.instances[0];
      // Simulate active subs but none with chatforiaWireless='true'
      stripeInstance.subscriptions.list.mockResolvedValueOnce({
        data: [
          {
            items: {
              data: [
                {
                  price: {
                    metadata: { chatforiaWireless: 'false' },
                  },
                },
              ],
            },
          },
        ],
      });

      await expect(
        createPortRequestForUser(mockUserWithCustomer, baseInput)
      ).rejects.toThrow(
        'A Chatforia Wireless plan is required to port a number.'
      );

      expect(stripeInstance.subscriptions.list).toHaveBeenCalledWith({
        customer: mockUserWithCustomer.stripeCustomerId,
        status: 'active',
      });
      expect(prisma.portRequest.create).not.toHaveBeenCalled();
    });

    it('creates a port request when user has a wireless plan', async () => {
      const stripeInstance = Stripe.mock.instances[0];
      // One subscription with chatforiaWireless='true'
      stripeInstance.subscriptions.list.mockResolvedValueOnce({
        data: [
          {
            items: {
              data: [
                {
                  price: {
                    metadata: { chatforiaWireless: 'true' },
                  },
                },
              ],
            },
          },
        ],
      });

      const mockCreated = {
        id: 'port_req_1',
        userId: mockUserWithCustomer.id,
        phoneNumber: baseInput.phoneNumber,
        status: 'PENDING',
      };

      prisma.portRequest.create.mockResolvedValueOnce(mockCreated);

      const result = await createPortRequestForUser(
        mockUserWithCustomer,
        baseInput
      );

      expect(result).toBe(mockCreated);

      expect(stripeInstance.subscriptions.list).toHaveBeenCalledWith({
        customer: mockUserWithCustomer.stripeCustomerId,
        status: 'active',
      });

      // Check that prisma.create was called with all fields + default country
      expect(prisma.portRequest.create).toHaveBeenCalledTimes(1);
      const call = prisma.portRequest.create.mock.calls[0][0];
      expect(call).toEqual({
        data: {
          userId: mockUserWithCustomer.id,
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
          country: 'US', // default
          status: 'PENDING',
        },
      });
    });
  });

  describe('getUserPortRequests', () => {
    it('returns list of port requests for user with correct query', async () => {
      const mockList = [
        { id: 'port_1', userId: 'user_1' },
        { id: 'port_2', userId: 'user_1' },
      ];

      prisma.portRequest.findMany.mockResolvedValueOnce(mockList);

      const result = await getUserPortRequests('user_1');

      expect(prisma.portRequest.findMany).toHaveBeenCalledWith({
        where: { userId: 'user_1' },
        orderBy: { createdAt: 'desc' },
      });
      expect(result).toBe(mockList);
    });
  });

  describe('getUserPortRequestById', () => {
    it('returns request when userId matches', async () => {
      const mockReq = {
        id: 'port_1',
        userId: 'user_1',
        phoneNumber: '+1 555 123 4567',
      };

      prisma.portRequest.findUnique.mockResolvedValueOnce(mockReq);

      const result = await getUserPortRequestById('user_1', 'port_1');

      expect(prisma.portRequest.findUnique).toHaveBeenCalledWith({
        where: { id: 'port_1' },
      });
      expect(result).toBe(mockReq);
    });

    it('returns null when request does not exist', async () => {
      prisma.portRequest.findUnique.mockResolvedValueOnce(null);

      const result = await getUserPortRequestById('user_1', 'port_missing');

      expect(prisma.portRequest.findUnique).toHaveBeenCalledWith({
        where: { id: 'port_missing' },
      });
      expect(result).toBeNull();
    });

    it('returns null when request belongs to a different user', async () => {
      const mockReq = {
        id: 'port_1',
        userId: 'another_user',
      };

      prisma.portRequest.findUnique.mockResolvedValueOnce(mockReq);

      const result = await getUserPortRequestById('user_1', 'port_1');

      expect(prisma.portRequest.findUnique).toHaveBeenCalledWith({
        where: { id: 'port_1' },
      });
      expect(result).toBeNull();
    });
  });

  describe('updatePortStatus', () => {
    it('updates status and timestamps correctly', async () => {
      const portRequestId = 'port_123';
      const scheduledAt = new Date('2030-01-01T10:00:00.000Z');
      const completedAt = new Date('2030-01-02T10:00:00.000Z');

      const mockUpdated = {
        id: portRequestId,
        status: 'COMPLETED',
      };

      prisma.portRequest.update.mockResolvedValueOnce(mockUpdated);

      const result = await updatePortStatus(portRequestId, {
        status: 'COMPLETED',
        statusReason: 'Done',
        scheduledAt,
        completedAt,
      });

      expect(prisma.portRequest.update).toHaveBeenCalledWith({
        where: { id: portRequestId },
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
      const portRequestId = 'port_456';
      prisma.portRequest.update.mockResolvedValueOnce({ id: portRequestId });

      await updatePortStatus(portRequestId, {
        status: 'FAILED',
        statusReason: 'Error',
        scheduledAt: undefined,
        completedAt: undefined,
      });

      const call = prisma.portRequest.update.mock.calls[0][0];
      expect(call).toEqual({
        where: { id: portRequestId },
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
