import { jest, describe, it, expect, beforeEach } from '@jest/globals';

const prismaPath = new URL('../../utils/prismaClient.js', import.meta.url).pathname;
const socketBusPath = new URL('../../services/socketBus.js', import.meta.url).pathname;

const mockMessageFindMany = jest.fn();
const mockUpdateMany = jest.fn();
const mockTxFindMany = jest.fn();
const mockTransaction = jest.fn();

const mockEmitMessageExpired = jest.fn();
const mockEmitMessageUpsert = jest.fn();

jest.unstable_mockModule(prismaPath, () => ({
  __esModule: true,
  default: {
    message: {
      findMany: mockMessageFindMany,
    },
    $transaction: mockTransaction,
  },
}));

jest.unstable_mockModule(socketBusPath, () => ({
  __esModule: true,
  emitMessageExpired: mockEmitMessageExpired,
  emitMessageUpsert: mockEmitMessageUpsert,
}));

const { processExpiredMessages } = await import('../pruneOldMessages.js');

describe('processExpiredMessages', () => {
  beforeEach(() => {
    jest.clearAllMocks();

    mockTransaction.mockImplementation(async (fn) =>
      fn({
        message: {
          updateMany: mockUpdateMany,
          findMany: mockTxFindMany,
        },
      })
    );
  });

  it('returns early when there are no expired messages', async () => {
    mockMessageFindMany.mockResolvedValueOnce([]);

    await processExpiredMessages();

    expect(mockMessageFindMany).toHaveBeenCalledTimes(1);
    expect(mockTransaction).not.toHaveBeenCalled();
    expect(mockEmitMessageUpsert).not.toHaveBeenCalled();
    expect(mockEmitMessageExpired).not.toHaveBeenCalled();
  });

  it('tombstones expired messages and emits socket events', async () => {
    const createdAt = new Date('2026-01-01T00:00:00.000Z');
    const expiresAt = new Date('2026-01-02T00:00:00.000Z');
    const deletedAt = new Date('2026-01-03T00:00:00.000Z');

    mockMessageFindMany.mockResolvedValueOnce([
      {
        id: 101,
        chatRoomId: 55,
        expiresAt,
        createdAt,
        senderId: 7,
      },
    ]);

    mockTxFindMany.mockResolvedValueOnce([
      {
        id: 101,
        chatRoomId: 55,
        createdAt,
        expiresAt,
        deletedForAll: true,
        deletedAt,
        deletedById: null,
        sender: {
          id: 7,
          username: 'julian',
          publicKey: 'public-key',
          avatarUrl: null,
        },
      },
    ]);

    await processExpiredMessages();

    expect(mockMessageFindMany).toHaveBeenCalledWith({
      where: {
        expiresAt: { lte: expect.any(Date) },
        deletedForAll: false,
      },
      take: 200,
      select: {
        id: true,
        chatRoomId: true,
        expiresAt: true,
        createdAt: true,
        senderId: true,
      },
    });

    expect(mockTransaction).toHaveBeenCalledTimes(1);

    expect(mockUpdateMany).toHaveBeenCalledWith({
      where: { id: { in: [101] } },
      data: {
        deletedForAll: true,
        deletedAt: expect.any(Date),
        deletedById: null,
        rawContent: null,
        contentCiphertext: null,
        translations: null,
        translatedContent: null,
      },
    });

    expect(mockTxFindMany).toHaveBeenCalledWith({
      where: { id: { in: [101] } },
      select: {
        id: true,
        chatRoomId: true,
        createdAt: true,
        expiresAt: true,
        deletedForAll: true,
        deletedAt: true,
        deletedById: true,
        sender: {
          select: {
            id: true,
            username: true,
            publicKey: true,
            avatarUrl: true,
          },
        },
      },
    });

    expect(mockEmitMessageUpsert).toHaveBeenCalledTimes(1);
    expect(mockEmitMessageUpsert).toHaveBeenCalledWith(
      55,
      expect.objectContaining({
        id: 101,
        chatRoomId: 55,
        createdAt: createdAt.toISOString(),
        expiresAt: expiresAt.toISOString(),
        deletedForAll: true,
        deletedAt: deletedAt.toISOString(),
        deletedById: null,
        rawContent: null,
        contentCiphertext: null,
        attachments: [],
        translatedForMe: null,
      })
    );

    expect(mockEmitMessageExpired).toHaveBeenCalledTimes(1);
    expect(mockEmitMessageExpired).toHaveBeenCalledWith(
      55,
      expect.objectContaining({
        id: 101,
        chatRoomId: 55,
        deletedForAll: true,
      })
    );
  });
});