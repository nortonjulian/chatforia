import express from 'express';
import asyncHandler from 'express-async-handler';
import Boom from '@hapi/boom';

import { requireAuth } from '../middleware/auth.js';
import prisma from '../utils/prismaClient.js';

import {
  requireRoomRank,
  RoleRank,
  getEffectiveRoomRank,
  canActOnRank,
} from '../utils/roomAuth.js';

const router = express.Router();

/* small helper: tolerate schemas without ownerId */
async function getRoomOwnerIdDbTolerant(roomId) {
  try {
    const r = await prisma.chatRoom.findUnique({
      where: { id: roomId },
      select: { ownerId: true },
    });
    return r?.ownerId ?? null;
  } catch {
    return null;
  }
}

/* =========================
 * CREATE (single handler)
 * ========================= */
router.post(
  '/',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { name, isGroup = false, userIds = [] } = req.body || {};
    const me = Number(req.user.id);

    const room = await prisma.$transaction(async (tx) => {
      let created;
      try {
        created = await tx.chatRoom.create({
          data: { name: name || undefined, isGroup: !!isGroup, ownerId: me },
        });
      } catch {
        created = await tx.chatRoom.create({
          data: { name: name || undefined, isGroup: !!isGroup },
        });
      }

      // creator becomes ADMIN participant
      await tx.participant.create({
        data: { chatRoomId: created.id, userId: me, role: 'ADMIN' },
      });

      if (Array.isArray(userIds) && userIds.length) {
        await tx.participant.createMany({
          data: userIds.map((uid) => ({
            chatRoomId: created.id,
            userId: Number(uid),
            role: 'MEMBER',
          })),
          skipDuplicates: true,
        });
      }
      return created;
    });

    return res.status(201).json({ id: room.id, room });
  })
);

/* =========================
 * LIST (cursor)
 * ========================= */
router.get(
  '/',
  requireAuth,
  asyncHandler(async (req, res) => {
    const limit = Math.min(Math.max(1, Number(req.query.limit ?? 30)), 100);
    const qUserId = req.query.userId ? Number(req.query.userId) : null;
    const whereBase = qUserId
      ? { participants: { some: { userId: qUserId } } }
      : {};

    const curIdRaw = req.query.cursorId;
    const curAtRaw = req.query.cursorUpdatedAt;

    let cursorId = null;
    let cursorAt = null;

    if (curIdRaw && curAtRaw) {
      const n = Number(curIdRaw);
      const d = new Date(curAtRaw);
      if (Number.isFinite(n) && !Number.isNaN(d.getTime())) {
        cursorId = n;
        cursorAt = d;
      }
    }

    const where =
      cursorId && cursorAt
        ? {
            ...whereBase,
            OR: [
              { updatedAt: { lt: cursorAt } },
              { updatedAt: cursorAt, id: { lt: cursorId } },
            ],
          }
        : whereBase;

    const items = await prisma.chatRoom.findMany({
      where,
      orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
      take: limit,
      include: { participants: { include: { user: true } } },
    });

    const nextCursor =
      items.length === limit
        ? {
            updatedAt: items[items.length - 1].updatedAt,
            id: items[items.length - 1].id,
          }
        : null;

    return res.json({ items, nextCursor, count: items.length });
  })
);

// GET /chatrooms/:id  (full room payload for ChatView)
// router.get(
//   '/:id',
//   requireAuth,
//   asyncHandler(async (req, res) => {
//     const rawId = req.params.id;

//     if (!rawId || rawId === 'undefined' || rawId === 'null') {
//       throw Boom.badRequest(`Invalid id (raw): ${rawId}`);
//     }

//     const id = Number(rawId);

//     if (!Number.isFinite(id)) {
//       throw Boom.badRequest(`Invalid id (parsed): ${rawId}`);
//     }

//     const me = Number(req.user.id);

//     // Ensure requester is a participant
//     const isParticipant = await prisma.participant.findFirst({
//       where: { chatRoomId: id, userId: me },
//       select: { userId: true },
//     });
//     if (!isParticipant) throw Boom.forbidden('Not a participant');

//     const room = await prisma.chatRoom.findUnique({
//       where: { id },
//       include: {
//         participants: {
//           include: {
//             user: {
//               select: {
//                 id: true,
//                 username: true,
//                 avatarUrl: true,
//                 preferredLanguage: true,
//                 publicKey: true,
//               },
//             },
//           },
//           orderBy: [{ role: 'desc' }, { userId: 'asc' }],
//         },
//       },
//     });

//     if (!room) throw Boom.notFound('Not found');
//     return res.json(room);
//   })
// );

router.get(
  '/:id',
  requireAuth,
  asyncHandler(async (req, res) => {
    console.log('[chatrooms/:id] URL =', req.originalUrl);
    console.log('[chatrooms/:id] raw id =', req.params.id);

    const rawId = req.params.id;

    if (!rawId || rawId === 'undefined' || rawId === 'null') {
      throw Boom.badRequest(`Invalid id (raw): ${rawId}`);
    }

    const id = Number(rawId);

    if (!Number.isFinite(id)) {
      throw Boom.badRequest(`Invalid id (parsed): ${rawId}`);
    }

    const me = Number(req.user.id);

    const isParticipant = await prisma.participant.findFirst({
      where: { chatRoomId: id, userId: me },
      select: { userId: true },
    });

    if (!isParticipant) throw Boom.forbidden('Not a participant');

    const room = await prisma.chatRoom.findUnique({
      where: { id },
      include: {
        participants: {
          include: {
            user: {
              select: {
                id: true,
                username: true,
                avatarUrl: true,
                preferredLanguage: true,
                publicKey: true,
              },
            },
          },
          orderBy: [{ role: 'desc' }, { userId: 'asc' }],
        },
      },
    });

    if (!room) throw Boom.notFound('Not found');
    return res.json(room);
  })
);

// GET /chatrooms/:id/participants
router.get(
  '/:id/participants',
  requireAuth,
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      return res.status(400).json({ error: 'Invalid id' });
    }

    const me = Number(req.user.id);

    const membership = await prisma.participant.findFirst({
      where: { chatRoomId: id, userId: me },
      select: { userId: true },
    });

    if (!membership) {
      return res.status(403).json({ error: 'Not a participant' });
    }

    const room = await prisma.chatRoom.findUnique({
      where: { id },
      select: {
        ownerId: true,
        participants: {
          select: {
            userId: true,
            role: true,
            user: {
              select: {
                id: true,
                username: true,
                publicKey: true,
              },
            },
          },
        },
      },
    });

    if (!room) {
      return res.status(404).json({ error: 'Room not found' });
    }

    return res.json({
      ownerId: room.ownerId ?? null,
      participants: room.participants,
    });
  })
);

/* =========================
 * DIRECT / GROUP
 * ========================= */

router.post(
  '/direct/:targetUserId',
  requireAuth,
  asyncHandler(async (req, res) => {
    const userId1 = Number(req.user.id);
    const userId2 = Number(req.params.targetUserId);

    if (!Number.isFinite(userId1) || !Number.isFinite(userId2) || userId1 === userId2) {
      throw Boom.badRequest('Invalid or duplicate user IDs');
    }

    const participantInclude = {
      participants: {
        include: {
          user: {
            select: {
              id: true,
              username: true,
              avatarUrl: true,
            },
          },
        },
      },
    };

    const existingRoom = await prisma.chatRoom.findFirst({
      where: {
        isGroup: false,
        AND: [
          { participants: { some: { userId: userId1 } } },
          { participants: { some: { userId: userId2 } } },
        ],
      },
      include: participantInclude,
    });

    if (existingRoom) return res.json(existingRoom);

    const newChatRoom = await prisma.chatRoom.create({
      data: {
        isGroup: false,
        participants: {
          create: [
            { user: { connect: { id: userId1 } }, role: 'ADMIN' },
            { user: { connect: { id: userId2 } }, role: 'MEMBER' },
          ],
        },
      },
      include: participantInclude,
    });

    return res.status(201).json(newChatRoom);
  })
);

router.post(
  '/group',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { userIds, name } = req.body || {};
    if (!Array.isArray(userIds) || userIds.length < 2) {
      throw Boom.badRequest('Provide at least 2 user IDs for a group chat');
    }

    const ids = [...new Set(userIds.map(Number))];

    const participantInclude = {
      participants: {
        include: {
          user: {
            select: {
              id: true,
              username: true,
              avatarUrl: true,
            },
          },
        },
      },
    };

    const existing = await prisma.chatRoom.findFirst({
      where: {
        isGroup: true,
        AND: [
          ...ids.map((id) => ({ participants: { some: { userId: id } } })),
          { participants: { every: { userId: { in: ids } } } },
        ],
      },
      include: participantInclude,
    });

    if (existing) return res.json(existing);

    const created = await prisma.chatRoom.create({
      data: {
        name: name || 'Group chat',
        isGroup: true,
        participants: {
          create: ids.map((id) => ({
            user: { connect: { id } },
            role: id === Number(req.user.id) ? 'ADMIN' : 'MEMBER',
          })),
        },
      },
      include: participantInclude,
    });

    return res.status(201).json(created);
  })
);

/* =========================
 * PARTICIPANTS / RANKS
 * ========================= */

router.get(
  '/:id/public-keys',
  requireAuth,
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) throw Boom.badRequest('Invalid id');

    const participants = await prisma.participant.findMany({
      where: { chatRoomId: id },
      include: {
        user: { select: { id: true, publicKey: true, username: true } },
      },
    });

    return res.json(participants.map((p) => p.user));
  })
);

/**
 * PROMOTE → Only room owner (if known) or global ADMIN may promote to ADMIN
 * Path the tests call: POST /rooms/:id/participants/:userId/promote
 */
router.post(
  '/:id/participants/:userId/promote',
  requireAuth,
  asyncHandler(async (req, res) => {
    const roomId = Number(req.params.id);
    const targetId = Number(req.params.userId);
    const actorId = Number(req.user?.id);
    const isGlobalAdmin = String(req.user?.role || '').toUpperCase() === 'ADMIN';

    if (!Number.isFinite(roomId) || !Number.isFinite(targetId) || !Number.isFinite(actorId)) {
      throw Boom.badRequest('Bad request');
    }

    // Permission
    let allowed = false;
    if (isGlobalAdmin) {
      allowed = true;
    } else {
      const ownerId = await getRoomOwnerIdDbTolerant(roomId);
      if (ownerId != null) {
        allowed = ownerId === actorId;
      } else {
        // fall back to rank computation if schema has no ownerId
        const rank = await getEffectiveRoomRank(prisma, actorId, roomId, req.user.role);
        allowed = rank != null && rank >= RoleRank.OWNER;
      }
    }
    if (!allowed) throw Boom.forbidden('Only owner can grant ADMIN');

    // Update participant role to ADMIN (composite-unique name tolerance)
    try {
      await prisma.participant.update({
        where: { chatRoomId_userId: { chatRoomId: roomId, userId: targetId } },
        data: { role: 'ADMIN' },
      });
    } catch (e1) {
      try {
        await prisma.participant.update({
          where: { userId_chatRoomId: { userId: targetId, chatRoomId: roomId } },
          data: { role: 'ADMIN' },
        });
      } catch (e2) {
        throw Boom.notFound('Participant not found');
      }
    }

    return res.json({ ok: true, participant: { userId: targetId, role: 'ADMIN' } });
  })
);

// POST participants (admin+)
router.post(
  '/:id/participants',
  requireAuth,
  requireRoomRank(prisma, RoleRank.ADMIN),
  asyncHandler(async (req, res) => {
    const roomId = Number(req.params.id);
    const { userId } = req.body ?? {};
    if (!Number.isFinite(roomId)) throw Boom.badRequest('Invalid id');
    if (!userId) throw Boom.badRequest('userId required');

    const existing = await prisma.participant.findUnique({
      where: { userId_chatRoomId: { userId: Number(userId), chatRoomId: roomId } },
    });
    if (existing) return res.json({ ok: true });

    const created = await prisma.participant.create({
      data: { userId: Number(userId), chatRoomId: roomId, role: 'MEMBER' },
      select: { userId: true, role: true },
    });

    return res.json({ ok: true, participant: created });
  })
);

// DELETE participants (rank ladder)
router.delete(
  '/:id/participants/:userId',
  requireAuth,
  asyncHandler(async (req, res) => {
    const roomId = Number(req.params.id);
    const targetId = Number(req.params.userId);
    if (!Number.isFinite(roomId) || !Number.isFinite(targetId)) throw Boom.badRequest('Invalid id');

    const actorRank = await getEffectiveRoomRank(prisma, req.user.id, roomId, req.user.role);
    if (actorRank === null || actorRank < RoleRank.MODERATOR) throw Boom.forbidden('Forbidden');

    const target = await prisma.participant.findUnique({
      where: { userId_chatRoomId: { userId: targetId, chatRoomId: roomId } },
      select: { role: true },
    });
    if (!target) return res.json({ ok: true });

    const targetRank = RoleRank[target.role] ?? RoleRank.MEMBER;
    if (!canActOnRank(actorRank, targetRank)) throw Boom.forbidden('Insufficient rank');

    await prisma.participant.delete({
      where: { userId_chatRoomId: { userId: targetId, chatRoomId: roomId } },
    });

    return res.json({ ok: true });
  })
);

/* =========================
 * META
 * ========================= */
router.get(
  '/:id/meta',
  requireAuth,
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) throw Boom.badRequest('Invalid id');

    const room = await prisma.chatRoom.findUnique({
      where: { id },
      select: { id: true, name: true, description: true },
    });
    if (!room) throw Boom.notFound('Not found');

    return res.json(room);
  })
);

router.patch(
  '/:id/meta',
  requireAuth,
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) throw Boom.badRequest('Invalid id');

    const { description } = req.body ?? {};
    const updated = await prisma.chatRoom.update({
      where: { id },
      data: { description: description ?? null },
      select: { id: true, description: true },
    });

    return res.json(updated);
  })
);

export default router;
