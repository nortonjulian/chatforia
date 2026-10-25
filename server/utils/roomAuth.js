import Boom from '@hapi/boom';

/** Highest wins */
export const RoleRank = Object.freeze({
  MEMBER: 0,
  MODERATOR: 1,
  ADMIN: 2,
  OWNER: 3,
});

/**
 * Resolve a user's effective rank in a room.
 * - Global ADMIN (site-wide) can be treated as room ADMIN (adjust to OWNER if desired).
 * - Returns one of RoleRank.* (never -1). Throws 404 if room missing, or returns null if not a participant.
 */
export async function getEffectiveRoomRank(
  prisma,
  actorUserId,
  roomId,
  actorGlobalRole
) {
  const rid = Number(roomId);
  const uid = Number(actorUserId);
  if (!Number.isFinite(rid) || !Number.isFinite(uid))
    throw Boom.badRequest('Invalid ids');

  // Global admin? Treat as room ADMIN (change to OWNER if you prefer).
  if (actorGlobalRole === 'ADMIN') return RoleRank.ADMIN;

  const room = await prisma.chatRoom.findUnique({
    where: { id: rid },
    select: { ownerId: true },
  });
  if (!room) throw Boom.notFound('Room not found');

  if (room.ownerId === uid) return RoleRank.OWNER;

  const participant = await prisma.participant.findUnique({
    where: { chatRoomId_userId: { chatRoomId: rid, userId: uid } },
    select: { role: true },
  });

  if (!participant) return null; // not a participant

  switch (participant.role) {
    case 'ADMIN':
      return RoleRank.ADMIN; // room admin (not global)
    case 'MODERATOR':
      return RoleRank.MODERATOR;
    case 'MEMBER':
    default:
      return RoleRank.MEMBER;
  }
}

/**
 * Middleware: require a minimum rank in room.
 * - Global ADMIN passes by virtue of getEffectiveRoomRank().
 * - Throws Boom errors; let global error middleware format response.
 */
export function requireRoomRank(prisma, minRank) {
  return async (req, _res, next) => {
    try {
      const roomId = Number(req.params.id ?? req.body?.chatRoomId);
      if (!Number.isFinite(roomId)) throw Boom.badRequest('Invalid room id');

      const rank = await getEffectiveRoomRank(
        prisma,
        req.user.id,
        roomId,
        req.user.role
      );
      if (rank === null) throw Boom.forbidden('Not a participant');
      if (rank < minRank) throw Boom.forbidden('Insufficient rank');

      return next();
    } catch (e) {
      return next(e);
    }
  };
}

/**
 * Can actor take a moderation action on target (kick/demote/etc.)?
 * Ladder rules:
 * - OWNER can act on anyone.
 * - ADMIN can act up to MODERATOR.
 * - MODERATOR can act on MEMBER only.
 */
export function canActOnRank(actorRank, targetRank) {
  if (actorRank >= RoleRank.OWNER) return true;
  if (actorRank >= RoleRank.ADMIN) return targetRank <= RoleRank.MODERATOR;
  if (actorRank >= RoleRank.MODERATOR) return targetRank <= RoleRank.MEMBER;
  return false;
}
