import prisma from '../utils/prismaClient.js';
import Boom from '@hapi/boom';

// Enforce on the server; never trust UI-side hiding to prevent contact.
export async function isBlockedEitherWay(firstId, secondId, db = prisma) {
  const first = Number(firstId);
  const second = Number(secondId);
  if (!Number.isInteger(first) || !Number.isInteger(second) || first <= 0 || second <= 0) {
    throw Boom.badRequest('Invalid user IDs for block check');
  }
  if (first === second) return false;
  const match = await db.userBlock.findFirst({
    where: { OR: [
      { blockerId: first, blockedId: second },
      { blockerId: second, blockedId: first },
    ] },
    select: { id: true },
  });
  return Boolean(match);
}

export async function assertDirectUsersAllowed(firstId, secondId, db = prisma) {
  if (await isBlockedEitherWay(firstId, secondId, db)) {
    throw Boom.forbidden('Direct interaction unavailable');
  }
}

// Existing 1:1 rooms remain readable for history; no new direct messages may pass.
// Group chats are intentionally not subject to blanket block restrictions.
export async function assertDirectRoomAllowed(roomId, senderId, db = prisma) {
  const room = await db.chatRoom.findUnique({
    where: { id: Number(roomId) },
    select: { isGroup: true, participants: { select: { userId: true } } },
  });
  if (!room || room.isGroup || room.participants.length !== 2) return;
  const ids = room.participants.map((p) => Number(p.userId));
  if (!ids.includes(Number(senderId))) return;
  const otherId = ids.find((id) => id !== Number(senderId));
  if (otherId != null) await assertDirectUsersAllowed(senderId, otherId, db);
}
