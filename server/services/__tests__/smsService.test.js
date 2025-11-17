// server/services/__tests__/smsService.test.js
import { jest } from '@jest/globals';

// ---- Shared mocks ----
const mockPrisma = {
  user: {
    findUnique: jest.fn(),
    findFirst: jest.fn(),
  },
  smsThread: {
    findFirst: jest.fn(),
    create: jest.fn(),
    findMany: jest.fn(),
    findUnique: jest.fn(),
  },
  smsMessage: {
    create: jest.fn(),
  },
};

const normalizeE164Mock = jest.fn((n) => n);
const isE164Mock = jest.fn(() => true);

const sendSmsMock = jest.fn(async () => ({
  provider: 'twilio',
  messageSid: 'SID-123',
}));

// ---- Mock modules BEFORE importing smsService ----
await jest.unstable_mockModule('../utils/prismaClient.js', () => ({
  __esModule: true,
  default: mockPrisma,
}));

await jest.unstable_mockModule('../utils/phone.js', () => ({
  __esModule: true,
  normalizeE164: normalizeE164Mock,
  isE164: isE164Mock,
}));

await jest.unstable_mockModule('../lib/telco/index.js', () => ({
  __esModule: true,
  sendSms: sendSmsMock,
}));

// ---- Import functions under test ----
const {
  sendUserSms,
  recordInboundSms,
  listThreads,
  getThread,
} = await import('../smsService.js');

describe('smsService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    normalizeE164Mock.mockImplementation((n) => n);
    isE164Mock.mockImplementation(() => true);
  });

  describe('sendUserSms', () => {
    it('sends SMS using existing thread and persists outbound message', async () => {
      // User has an assigned number
      mockPrisma.user.findUnique.mockResolvedValue({
        assignedNumbers: [{ e164: '+19998887777' }],
      });

      // Existing thread
      mockPrisma.smsThread.findFirst.mockResolvedValue({
        id: 10,
        userId: 1,
        contactPhone: '+15551234567',
      });

      const result = await sendUserSms({
        userId: 1,
        to: '+15551234567',
        body: 'Hello there',
      });

      // Normalization + validation for destination
      expect(normalizeE164Mock).toHaveBeenCalledWith('+15551234567');
      expect(isE164Mock).toHaveBeenCalled();

      // User "from" lookup
      expect(mockPrisma.user.findUnique).toHaveBeenCalledWith({
        where: { id: 1 },
        select: {
          assignedNumbers: {
            select: { e164: true },
            take: 1,
            orderBy: { id: 'asc' },
          },
        },
      });

      // Thread lookup (no create)
      expect(mockPrisma.smsThread.findFirst).toHaveBeenCalledWith({
        where: { userId: 1, contactPhone: '+15551234567' },
      });
      expect(mockPrisma.smsThread.create).not.toHaveBeenCalled();

      // Telco send
      expect(sendSmsMock).toHaveBeenCalledTimes(1);
      const sendArgs = sendSmsMock.mock.calls[0][0];
      expect(sendArgs).toMatchObject({
        to: '+15551234567',
        text: 'Hello there',
      });
      expect(sendArgs.clientRef).toMatch(/^smsout:1:/);

      // SMS persisted
      expect(mockPrisma.smsMessage.create).toHaveBeenCalledWith({
        data: {
          threadId: 10,
          direction: 'out',
          fromNumber: '+19998887777',
          toNumber: '+15551234567',
          body: 'Hello there',
          provider: 'twilio',
        },
      });

      expect(result).toEqual({
        ok: true,
        threadId: 10,
        provider: 'twilio',
        messageSid: 'SID-123',
      });
    });

    it('creates a new thread when none exists', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({
        assignedNumbers: [{ e164: '+19998887777' }],
      });

      mockPrisma.smsThread.findFirst.mockResolvedValue(null);
      mockPrisma.smsThread.create.mockResolvedValue({
        id: 20,
        userId: 1,
        contactPhone: '+15551234567',
      });

      const result = await sendUserSms({
        userId: 1,
        to: '+15551234567',
        body: 'Hi new thread',
      });

      expect(mockPrisma.smsThread.create).toHaveBeenCalledWith({
        data: {
          userId: 1,
          contactPhone: '+15551234567',
        },
      });

      expect(result.threadId).toBe(20);
    });

    it('throws Boom 400 when destination phone is invalid', async () => {
      // First validation of "to" fails
      isE164Mock.mockReturnValueOnce(false);

      await expect(
        sendUserSms({
          userId: 1,
          to: 'not-a-phone',
          body: 'Hi',
        }),
      ).rejects.toMatchObject({
        isBoom: true,
        output: { statusCode: 400 },
        message: 'Invalid destination phone',
      });

      // No DB or telco calls
      expect(mockPrisma.user.findUnique).not.toHaveBeenCalled();
      expect(sendSmsMock).not.toHaveBeenCalled();
    });

    it('throws Boom 412 when user has no assigned number', async () => {
      // Destination is valid
      isE164Mock.mockReturnValue(true);

      // User has no assigned numbers
      mockPrisma.user.findUnique.mockResolvedValue({
        assignedNumbers: [],
      });

      await expect(
        sendUserSms({
          userId: 1,
          to: '+15551234567',
          body: 'Hi',
        }),
      ).rejects.toMatchObject({
        isBoom: true,
        output: { statusCode: 412 },
        message: 'No assigned number for user',
      });

      // Thread and telco never reached
      expect(mockPrisma.smsThread.findFirst).not.toHaveBeenCalled();
      expect(sendSmsMock).not.toHaveBeenCalled();
    });
  });

  describe('recordInboundSms', () => {
    it('persists inbound SMS when owner is found and returns ok', async () => {
      // Owner lookup by assignedNumbers.some(e164 == normalize(toNumber))
      mockPrisma.user.findFirst.mockResolvedValue({ id: 7 });

      // No existing thread -> create
      mockPrisma.smsThread.findFirst.mockResolvedValue(null);
      mockPrisma.smsThread.create.mockResolvedValue({
        id: 33,
        userId: 7,
        contactPhone: '+15551234567',
      });

      const result = await recordInboundSms({
        toNumber: '+19998887777',
        fromNumber: '+15551234567',
        body: 'Yo from outside',
        provider: 'twilio',
      });

      // Owner lookup
      expect(mockPrisma.user.findFirst).toHaveBeenCalledWith({
        where: {
          assignedNumbers: {
            some: { e164: '+19998887777' },
          },
        },
        select: { id: true },
      });

      // Thread upsert
      expect(mockPrisma.smsThread.findFirst).toHaveBeenCalledWith({
        where: { userId: 7, contactPhone: '+15551234567' },
      });
      expect(mockPrisma.smsThread.create).toHaveBeenCalledWith({
        data: { userId: 7, contactPhone: '+15551234567' },
      });

      // Inbound message persisted
      expect(mockPrisma.smsMessage.create).toHaveBeenCalledWith({
        data: {
          threadId: 33,
          direction: 'in',
          fromNumber: '+15551234567',
          toNumber: '+19998887777',
          body: 'Yo from outside',
          provider: 'twilio',
        },
      });

      expect(result).toEqual({
        ok: true,
        userId: 7,
        threadId: 33,
      });
    });

    it('returns ok:false with reason no-owner when no user has the DID', async () => {
      mockPrisma.user.findFirst.mockResolvedValue(null);

      const result = await recordInboundSms({
        toNumber: '+19998887777',
        fromNumber: '+15551234567',
        body: 'Hi',
        provider: 'twilio',
      });

      expect(result).toEqual({ ok: false, reason: 'no-owner' });
      expect(mockPrisma.smsThread.findFirst).not.toHaveBeenCalled();
      expect(mockPrisma.smsMessage.create).not.toHaveBeenCalled();
    });
  });

  describe('listThreads', () => {
    it('returns threads for user ordered by updatedAt desc', async () => {
      mockPrisma.smsThread.findMany.mockResolvedValue([
        { id: 1 },
        { id: 2 },
      ]);

      const threads = await listThreads(5);

      expect(mockPrisma.smsThread.findMany).toHaveBeenCalledWith({
        where: { userId: 5 },
        orderBy: { updatedAt: 'desc' },
      });
      expect(threads).toEqual([{ id: 1 }, { id: 2 }]);
    });
  });

  describe('getThread', () => {
    it('returns thread when it belongs to the user', async () => {
      const threadObj = {
        id: 10,
        userId: 3,
        messages: [],
      };
      mockPrisma.smsThread.findUnique.mockResolvedValue(threadObj);

      const thread = await getThread(3, '10');

      expect(mockPrisma.smsThread.findUnique).toHaveBeenCalledWith({
        where: { id: 10 },
        include: { messages: { orderBy: { createdAt: 'asc' } } },
      });

      expect(thread).toBe(threadObj);
    });

    it('throws Boom 404 when thread does not exist', async () => {
      mockPrisma.smsThread.findUnique.mockResolvedValue(null);

      await expect(getThread(3, 99)).rejects.toMatchObject({
        isBoom: true,
        output: { statusCode: 404 },
        message: 'Thread not found',
      });
    });

    it('throws Boom 404 when thread belongs to a different user', async () => {
      mockPrisma.smsThread.findUnique.mockResolvedValue({
        id: 10,
        userId: 999,
        messages: [],
      });

      await expect(getThread(3, 10)).rejects.toMatchObject({
        isBoom: true,
        output: { statusCode: 404 },
        message: 'Thread not found',
      });
    });
  });
});
