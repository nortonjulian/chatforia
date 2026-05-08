import { jest } from '@jest/globals';

const mockPrisma = {
  user: {
    findUnique: jest.fn(),
    findFirst: jest.fn(),
  },
  contact: {
    findFirst: jest.fn(),
  },
  phoneNumber: {
    findFirst: jest.fn(),
    updateMany: jest.fn(),
  },
  smsOptOut: {
    findFirst: jest.fn(),
  },
  smsThread: {
    findFirst: jest.fn(),
    create: jest.fn(),
    findMany: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  },
  smsParticipant: {
    upsert: jest.fn(),
  },
  smsMessage: {
    create: jest.fn(),
    findMany: jest.fn(),
    findFirst: jest.fn(),
    delete: jest.fn(),
    update: jest.fn(),
    deleteMany: jest.fn(),
  },
  $transaction: jest.fn(async (fnOrOps) => {
    if (typeof fnOrOps === 'function') {
      return fnOrOps(mockPrisma);
    }
    return Promise.all(fnOrOps);
  }),
};

const normalizeE164Mock = jest.fn((n) => n);
const isE164Mock = jest.fn(() => true);

const sendSmsMock = jest.fn(async () => ({
  ok: true,
  provider: 'twilio',
  messageSid: 'SID-123',
  clientRef: 'client-ref-123',
}));

const emitToUserMock = jest.fn();
const recordSupportSignalMock = jest.fn();

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

await jest.unstable_mockModule('../services/socketBus.js', () => ({
  __esModule: true,
  emitToUser: emitToUserMock,
}));

await jest.unstable_mockModule('../services/supportAutomationService.js', () => ({
  __esModule: true,
  recordSupportSignal: recordSupportSignalMock,
}));

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

    mockPrisma.smsOptOut.findFirst.mockResolvedValue(null);
    mockPrisma.contact.findFirst.mockResolvedValue(null);
    mockPrisma.smsParticipant.upsert.mockResolvedValue({});
    mockPrisma.phoneNumber.updateMany.mockResolvedValue({ count: 1 });
    mockPrisma.smsThread.update.mockResolvedValue({});
    mockPrisma.smsMessage.create.mockResolvedValue({
      id: 500,
      body: 'mock message',
    });

    sendSmsMock.mockResolvedValue({
      ok: true,
      provider: 'twilio',
      messageSid: 'SID-123',
      clientRef: 'client-ref-123',
    });
  });

  describe('sendUserSms', () => {
    it('sends SMS using existing thread and persists outbound message', async () => {
      mockPrisma.phoneNumber.findFirst.mockResolvedValue({
        id: 1,
        e164: '+19998887777',
        status: 'ASSIGNED',
      });

      mockPrisma.smsThread.findFirst.mockResolvedValue({
        id: 10,
        userId: 1,
        contactPhone: '+15551234567',
        contactId: null,
      });

      const result = await sendUserSms({
        userId: 1,
        to: '+15551234567',
        body: 'Hello there',
      });

      expect(normalizeE164Mock).toHaveBeenCalledWith('+15551234567');
      expect(isE164Mock).toHaveBeenCalled();

      expect(mockPrisma.smsOptOut.findFirst).toHaveBeenCalledWith({
        where: {
          phone: '+15551234567',
          OR: [{ provider: 'twilio' }, { provider: null }],
        },
      });

      expect(mockPrisma.phoneNumber.findFirst).toHaveBeenCalledWith({
        where: {
          assignedUserId: 1,
          status: { in: ['ASSIGNED', 'HOLD'] },
        },
        select: { id: true, e164: true, status: true },
        orderBy: { assignedAt: 'desc' },
      });

      expect(sendSmsMock).toHaveBeenCalledTimes(1);
      expect(sendSmsMock.mock.calls[0][0]).toMatchObject({
        to: '+15551234567',
        text: 'Hello there',
        from: '+19998887777',
        mediaUrls: [],
      });
      expect(sendSmsMock.mock.calls[0][0].clientRef).toMatch(/^smsout:1:/);

      expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1);
      expect(mockPrisma.smsMessage.create).toHaveBeenCalledWith({
        data: {
          threadId: 10,
          direction: 'out',
          fromNumber: '+19998887777',
          toNumber: '+15551234567',
          body: 'Hello there',
          provider: 'twilio',
          providerMessageId: 'SID-123',
          mediaUrls: null,
        },
      });

      expect(emitToUserMock).toHaveBeenCalledWith(1, 'sms:message:new', {
        threadId: 10,
        message: {
          id: 500,
          body: 'mock message',
        },
      });

      expect(result).toEqual({
        ok: true,
        threadId: 10,
        provider: 'twilio',
        messageSid: 'SID-123',
        clientRef: 'client-ref-123',
      });
    });

    it('creates a new thread when none exists', async () => {
      mockPrisma.phoneNumber.findFirst.mockResolvedValue({
        id: 1,
        e164: '+19998887777',
        status: 'ASSIGNED',
      });

      mockPrisma.smsThread.findFirst.mockResolvedValue(null);
      mockPrisma.smsThread.create.mockResolvedValue({
        id: 20,
        userId: 1,
        contactPhone: '+15551234567',
        contactId: null,
      });

      const result = await sendUserSms({
        userId: 1,
        to: '+15551234567',
        body: 'Hi new thread',
      });

      expect(mockPrisma.smsThread.create).toHaveBeenCalledWith({
        data: {
          userId: 1,
          contactId: null,
          contactPhone: '+15551234567',
          participants: {
            create: [{ phone: '+15551234567' }],
          },
        },
        select: { id: true, contactPhone: true, contactId: true },
      });

      expect(result.threadId).toBe(20);
    });

    it('throws Boom 400 when destination phone is invalid', async () => {
      isE164Mock.mockReturnValueOnce(false);

      await expect(
        sendUserSms({
          userId: 1,
          to: 'not-a-phone',
          body: 'Hi',
        })
      ).rejects.toMatchObject({
        isBoom: true,
        output: { statusCode: 400 },
        message: 'Invalid destination phone',
      });

      expect(mockPrisma.phoneNumber.findFirst).not.toHaveBeenCalled();
      expect(sendSmsMock).not.toHaveBeenCalled();
    });

    it('throws Boom 412 when user has no assigned number', async () => {
      mockPrisma.smsOptOut.findFirst.mockResolvedValue(null);
      mockPrisma.phoneNumber.findFirst.mockResolvedValue(null);

      await expect(
        sendUserSms({
          userId: 1,
          to: '+15551234567',
          body: 'Hi',
        })
      ).rejects.toMatchObject({
        isBoom: true,
        output: { statusCode: 412 },
        message: 'No assigned number for user',
      });

      expect(recordSupportSignalMock).toHaveBeenCalledWith({
        userId: 1,
        category: 'no_assigned_number',
        source: 'sms_send',
        actionTaken: 'prompt_number_selection',
      });

      expect(mockPrisma.smsThread.findFirst).not.toHaveBeenCalled();
      expect(sendSmsMock).not.toHaveBeenCalled();
    });
  });

  describe('recordInboundSms', () => {
    it('persists inbound SMS when owner is found and returns ok', async () => {
      mockPrisma.phoneNumber.findFirst.mockResolvedValue({
        assignedUserId: 7,
      });

      mockPrisma.smsThread.findFirst.mockResolvedValue(null);
      mockPrisma.smsThread.create.mockResolvedValue({
        id: 33,
        userId: 7,
        contactPhone: '+15551234567',
        contactId: null,
      });

      mockPrisma.smsMessage.create.mockResolvedValue({
        id: 700,
        body: 'Yo from outside',
      });

      const result = await recordInboundSms({
        toNumber: '+19998887777',
        fromNumber: '+15551234567',
        body: 'Yo from outside',
        provider: 'twilio',
        providerMessageId: 'SM-IN-1',
      });

      expect(mockPrisma.phoneNumber.findFirst).toHaveBeenCalledWith({
        where: {
          e164: '+19998887777',
          status: { in: ['ASSIGNED', 'HOLD'] },
          assignedUserId: { not: null },
        },
        select: { assignedUserId: true },
      });

      expect(mockPrisma.smsThread.create).toHaveBeenCalledWith({
        data: {
          userId: 7,
          contactId: null,
          contactPhone: '+15551234567',
          participants: {
            create: [{ phone: '+15551234567' }],
          },
        },
        select: { id: true, contactPhone: true, contactId: true },
      });

      expect(mockPrisma.smsMessage.create).toHaveBeenCalledWith({
        data: {
          threadId: 33,
          direction: 'in',
          fromNumber: '+15551234567',
          toNumber: '+19998887777',
          body: 'Yo from outside',
          provider: 'twilio',
          providerMessageId: 'SM-IN-1',
          mediaUrls: null,
        },
      });

      expect(emitToUserMock).toHaveBeenCalledWith(7, 'sms:message:new', {
        threadId: 33,
        message: {
          id: 700,
          body: 'Yo from outside',
        },
      });

      expect(result).toEqual({
        ok: true,
        userId: 7,
        threadId: 33,
      });
    });

    it('returns ok:false with reason no-owner when no user has the DID', async () => {
      mockPrisma.phoneNumber.findFirst.mockResolvedValue(null);

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
      const updatedAt1 = new Date('2026-01-01T00:00:00Z');
      const updatedAt2 = new Date('2026-01-02T00:00:00Z');

      mockPrisma.smsThread.findMany.mockResolvedValue([
        {
          id: 1,
          contactPhone: '+15550000001',
          updatedAt: updatedAt1,
          participants: [],
        },
        {
          id: 2,
          contactPhone: '+15550000002',
          updatedAt: updatedAt2,
          participants: [],
        },
      ]);

      mockPrisma.contact.findFirst.mockResolvedValue(null);

      const threads = await listThreads(5);

      expect(mockPrisma.smsThread.findMany).toHaveBeenCalledWith({
        where: {
          userId: 5,
          archivedAt: null,
          messages: {
            some: {},
          },
        },
        orderBy: { updatedAt: 'desc' },
        select: {
          id: true,
          contactPhone: true,
          updatedAt: true,
          participants: {
            select: { phone: true },
            take: 5,
          },
        },
        take: 200,
      });

      expect(threads).toEqual([
        {
          id: 1,
          contactPhone: '+15550000001',
          updatedAt: updatedAt1,
          displayName: '+15550000001',
          contactName: '+15550000001',
        },
        {
          id: 2,
          contactPhone: '+15550000002',
          updatedAt: updatedAt2,
          displayName: '+15550000002',
          contactName: '+15550000002',
        },
      ]);
    });
  });

  describe('getThread', () => {
    it('returns thread when it belongs to the user', async () => {
      mockPrisma.smsThread.findFirst.mockResolvedValue({
        id: 10,
        userId: 3,
        contactPhone: '+15551234567',
        contactId: null,
        participants: [],
      });

      mockPrisma.smsMessage.findMany.mockResolvedValue([]);
      mockPrisma.contact.findFirst.mockResolvedValue(null);

      const thread = await getThread(3, '10');

      expect(mockPrisma.smsThread.findFirst).toHaveBeenCalledWith({
        where: { id: 10, userId: 3 },
        include: {
          participants: { select: { phone: true }, take: 5 },
        },
      });

      expect(mockPrisma.smsMessage.findMany).toHaveBeenCalledWith({
        where: { threadId: 10 },
        orderBy: { createdAt: 'asc' },
      });

      expect(thread).toEqual({
        id: 10,
        userId: 3,
        contactPhone: '+15551234567',
        contactId: null,
        participants: [],
        displayName: '+15551234567',
        contactName: '+15551234567',
        messages: [],
      });
    });

    it('throws Boom 404 when thread does not exist', async () => {
      mockPrisma.smsThread.findFirst.mockResolvedValue(null);

      await expect(getThread(3, 99)).rejects.toMatchObject({
        isBoom: true,
        output: { statusCode: 404 },
        message: 'Thread not found',
      });
    });

    it('throws Boom 404 when thread belongs to a different user', async () => {
      mockPrisma.smsThread.findFirst.mockResolvedValue(null);

      await expect(getThread(3, 10)).rejects.toMatchObject({
        isBoom: true,
        output: { statusCode: 404 },
        message: 'Thread not found',
      });

      expect(mockPrisma.smsThread.findFirst).toHaveBeenCalledWith({
        where: { id: 10, userId: 3 },
        include: {
          participants: { select: { phone: true }, take: 5 },
        },
      });
    });
  });
});