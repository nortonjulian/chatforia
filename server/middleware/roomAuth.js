import Boom from '@hapi/boom';
import { prisma } from '../utils/prismaClient.js';

/**
 * Returns { role: 'ADMIN'|'MODERATOR'|'MEMBER'|null } for a user in a room.
 * Global app ADMIN bypasses room checks (returns 'ADMIN').
 */
export async function getRoomRole(user, chatRoomId) {
  if (!user?.id) return { role: null };

  // Global app admin short-circuit
  if (user.role === 'ADMIN') return { role: 'ADMIN' };

  const member = await prisma.participant.findUnique({
    where: {
      chatRoomId_userId: {
        chatRoomId: Number(chatRoomId),
        userId: Number(user.id),
      },
    },
    select: { role: true },
  });

  return { role: member?.role ?? null };
}

function ensureRoleOrThrow(actual, allowed) {
  if (!actual) throw Boom.forbidden('Not a member of this room');
  if (!allowed.includes(actual))
    throw Boom.forbidden('Insufficient room permissions');
}

/**
 * Requires the requester to be a member of the room.
 */
export function requireRoomMember(param = 'id') {
  return async (req, _res, next) => {
    const chatRoomId = Number(req.params[param] ?? req.body.chatRoomId);
    const { role } = await getRoomRole(req.user, chatRoomId);
    try {
      ensureRoleOrThrow(role, ['MEMBER', 'MODERATOR', 'ADMIN']);
      next();
    } catch (e) {
      next(e);
    }
  };
}

/**
 * Requires MODERATOR or ADMIN in the room (or global ADMIN).
 */
export function requireRoomAdmin(param = 'id') {
  return async (req, _res, next) => {
    const chatRoomId = Number(req.params[param] ?? req.body.chatRoomId);
    const { role } = await getRoomRole(req.user, chatRoomId);
    try {
      ensureRoleOrThrow(role, ['MODERATOR', 'ADMIN']);
      next();
    } catch (e) {
      next(e);
    }
  };
}

/**
 * Useful inline helper if you don’t want middleware.
 */
export async function assertRoomAdminOrThrow(user, chatRoomId) {
  const { role } = await getRoomRole(user, chatRoomId);
  ensureRoleOrThrow(role, ['MODERATOR', 'ADMIN']);
}
