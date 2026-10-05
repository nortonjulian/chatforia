import { jest } from '@jest/globals';

const messageFindManyMock = jest.fn();
const smsThreadFindManyMock = jest.fn();
const callCountMock = jest.fn();
const voicemailCountMock = jest.fn();
const threadStateFindManyMock = jest.fn();

await jest.unstable_mockModule('../utils/prismaClient.js', () => ({
  __esModule: true,
  default: {
    message: { findMany: messageFindManyMock },
    smsThread: { findMany: smsThreadFindManyMock },
    call: { count: callCountMock },
    voicemail: { count: voicemailCountMock },
    threadState: { findMany: threadStateFindManyMock },
  },
}));

const { getBadgeState } = await import('../badgeState.js');

describe('badgeState', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    messageFindManyMock.mockResolvedValue([]);
    smsThreadFindManyMock.mockResolvedValue([]);
    callCountMock.mockResolvedValue(0);
    voicemailCountMock.mockResolvedValue(0);
    threadStateFindManyMock.mockResolvedValue([]);
  });

  test('counts multiple unread messages in one chat room as one conversation', async () => {
    messageFindManyMock.mockResolvedValue([
      { chatRoomId: 10, createdAt: new Date('2026-09-27T18:00:00Z') },
      { chatRoomId: 10, createdAt: new Date('2026-09-27T18:01:00Z') },
      { chatRoomId: 10, createdAt: new Date('2026-09-27T18:02:00Z') },
    ]);
    expect(await getBadgeState(7)).toEqual({
      unreadConversations: 1, missedCalls: 0, unreadVoicemails: 0, total: 1,
    });
  });

  test('counts unread messages in different chat rooms separately', async () => {
    messageFindManyMock.mockResolvedValue([
      { chatRoomId: 10, createdAt: new Date('2026-09-27T18:00:00Z') },
      { chatRoomId: 20, createdAt: new Date('2026-09-27T18:01:00Z') },
      { chatRoomId: 30, createdAt: new Date('2026-09-27T18:02:00Z') },
    ]);
    const result = await getBadgeState(7);
    expect(result.unreadConversations).toBe(3);
    expect(result.total).toBe(3);
  });

  test('does not count messages at or before a thread deletion boundary', async () => {
    messageFindManyMock.mockResolvedValue([
      { chatRoomId: 10, createdAt: new Date('2026-09-27T18:00:00Z') },
      { chatRoomId: 20, createdAt: new Date('2026-09-27T19:00:00Z') },
    ]);
    threadStateFindManyMock.mockResolvedValue([
      { chatRoomId: 10, deletedAt: new Date('2026-09-27T18:30:00Z') },
      { chatRoomId: 20, deletedAt: new Date('2026-09-27T18:30:00Z') },
    ]);
    expect((await getBadgeState(7)).unreadConversations).toBe(1);
  });

  test('counts each SMS thread with a newer inbound message once', async () => {
    smsThreadFindManyMock.mockResolvedValue([
      { id: 1, lastReadAt: null, messages: [
        { createdAt: new Date('2026-09-27T17:00:00Z') },
        { createdAt: new Date('2026-09-27T17:01:00Z') },
      ]},
      { id: 2, lastReadAt: new Date('2026-09-27T18:00:00Z'), messages: [
        { createdAt: new Date('2026-09-27T17:59:00Z') },
      ]},
      { id: 3, lastReadAt: new Date('2026-09-27T18:00:00Z'), messages: [
        { createdAt: new Date('2026-09-27T18:01:00Z') },
      ]},
    ]);
    expect((await getBadgeState(7)).unreadConversations).toBe(2);
  });

  test('requests only unacknowledged missed calls relevant to the user', async () => {
    callCountMock.mockResolvedValue(2);
    const result = await getBadgeState(7);
    expect(callCountMock).toHaveBeenCalledWith({
      where: {
        status: 'MISSED',
        acknowledgedAt: null,
        OR: [
          { calleeId: 7 },
          { callerId: 7, calleeId: null, externalPhone: { not: null } },
        ],
      },
    });
    expect(result.missedCalls).toBe(2);
  });

  test('requests only unread non-deleted voicemails for the user', async () => {
    voicemailCountMock.mockResolvedValue(3);
    const result = await getBadgeState(7);
    expect(voicemailCountMock).toHaveBeenCalledWith({
      where: { userId: 7, deleted: false, isRead: false },
    });
    expect(result.unreadVoicemails).toBe(3);
  });

  test('returns 2 chats + 1 missed call + 1 voicemail as total 4', async () => {
    messageFindManyMock.mockResolvedValue([
      { chatRoomId: 10, createdAt: new Date('2026-09-27T18:00:00Z') },
      { chatRoomId: 20, createdAt: new Date('2026-09-27T18:01:00Z') },
    ]);
    callCountMock.mockResolvedValue(1);
    voicemailCountMock.mockResolvedValue(1);
    expect(await getBadgeState(7)).toEqual({
      unreadConversations: 2, missedCalls: 1, unreadVoicemails: 1, total: 4,
    });
  });

  test('scopes unread chat lookup to messages not sent by the current user', async () => {
    await getBadgeState(7);
    const query = messageFindManyMock.mock.calls[0][0];
    expect(query.where.senderId).toEqual({ not: 7 });
    expect(query.where.reads).toEqual({ none: { userId: 7 } });
    expect(query.where.deletedForAll).toBe(false);
  });
});
