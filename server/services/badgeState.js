import prisma from '../utils/prismaClient.js';

export async function getBadgeState(userIdValue) {
  const userId = Number(userIdValue);
  const now = new Date();

  const [unreadChatMessages, smsThreads, missedCalls, unreadVoicemails] =
    await Promise.all([
      prisma.message.findMany({
        where: {
          senderId: { not: userId },
          deletedForAll: false,
          reads: { none: { userId } },
          OR: [
            { expiresAt: null },
            { expiresAt: { gt: now } },
          ],
          chatRoom: {
            participants: { some: { userId, archivedAt: null } },
            OR: [
              { randomChatRoom: { is: null } },
              { randomChatRoom: { is: { endedAt: null, unlockedAt: null } } },
            ],
          },
        },
        select: { chatRoomId: true, createdAt: true },
      }),
      prisma.smsThread.findMany({
        where: { userId, archivedAt: null, deletedAt: null },
        select: {
          id: true,
          lastReadAt: true,
          messages: {
            where: { direction: 'in' },
            select: { createdAt: true },
          },
        },
      }),
      prisma.call.count({
        where: {
          status: 'MISSED',
          acknowledgedAt: null,
          OR: [
            { calleeId: userId },
            { callerId: userId, calleeId: null, externalPhone: { not: null } },
          ],
        },
      }),
      prisma.voicemail.count({
        where: { userId, deleted: false, isRead: false },
      }),
    ]);

  const roomIds = [...new Set(unreadChatMessages.map((m) => m.chatRoomId))];
  const threadStates = roomIds.length
    ? await prisma.threadState.findMany({
        where: { userId, chatRoomId: { in: roomIds } },
        select: { chatRoomId: true, deletedAt: true },
      })
    : [];

  const deletedAtByRoom = new Map(
    threadStates.map((state) => [state.chatRoomId, state.deletedAt])
  );

  const unreadChatRoomIds = new Set();
  for (const message of unreadChatMessages) {
    const deletedAt = deletedAtByRoom.get(message.chatRoomId);
    if (deletedAt && message.createdAt <= deletedAt) continue;
    unreadChatRoomIds.add(message.chatRoomId);
  }

  const unreadSmsThreads = smsThreads.reduce((count, thread) => {
    const hasUnread = thread.messages.some(
      (message) => !thread.lastReadAt || message.createdAt > thread.lastReadAt
    );
    return count + (hasUnread ? 1 : 0);
  }, 0);

  const unreadConversations = unreadChatRoomIds.size + unreadSmsThreads;

  return {
    unreadConversations,
    missedCalls,
    unreadVoicemails,
    total: unreadConversations + missedCalls + unreadVoicemails,
  };
}
