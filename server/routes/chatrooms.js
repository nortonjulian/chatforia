import express from 'express';
import asyncHandler from 'express-async-handler';
import Boom from '@hapi/boom';

import { requireAuth } from '../middleware/auth.js';
import prisma from '../utils/prismaClient.js';
import { assertDirectUsersAllowed } from '../services/userBlockService.js';
import { getIo } from '../services/socketBus.js';

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
    if (!isGroup && Array.isArray(userIds)) {
      for (const target of userIds) await assertDirectUsersAllowed(me, Number(target));
    }

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
    const me = Number(req.user?.id);
    if (!Number.isSafeInteger(me) || me <= 0) throw Boom.unauthorized();
    const qUserId = req.query.userId ? Number(req.query.userId) : null;
    if (req.query.userId && (!Number.isSafeInteger(qUserId) || qUserId <= 0)) {
      throw Boom.badRequest('Invalid userId');
    }
    // Always scope to the authenticated user. An optional userId only narrows it.
    const whereBase = {
      AND: [
        { participants: { some: { userId: me } } },
        ...(qUserId ? [{ participants: { some: { userId: qUserId } } }] : []),
      ],
    };

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
      // Never expose users' private identity, billing or credential fields.
      include: {
        participants: {
          include: {
            user: {
              select: {
                id: true,
                username: true,
                displayName: true,
                avatarUrl: true,
                publicKey: true,
                preferredLanguage: true,
                autoTranslate: true,
              },
            },
          },
        },
      },
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

        randomChatRoom: {
          select: {
            id: true,
            chatRoomId: true,
            aliasByUser: true,
            endedAt: true,
            endedReason: true,
            endedById: true,
            unlockedAt: true,
            aiEnabled: true,
            createdAt: true,
          },
        },
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

    const randomChat = room.randomChatRoom || null;
    const aliasByUser =
      randomChat?.aliasByUser &&
      typeof randomChat.aliasByUser === 'object'
        ? randomChat.aliasByUser
        : {};

    function aliasForUser(id) {
      return aliasByUser[String(id)] || aliasByUser[Number(id)] || null;
    }

    const otherParticipant = (room.participants || []).find(
      (p) => Number(p.userId) !== Number(me)
    );

    return res.json({
      ...room,
      me: {
        allowAIBot: room.participants?.find((p) => Number(p.userId) === me)?.allowAIBot ?? false,
      },
      isRandomChat: Boolean(randomChat),
      randomChat: randomChat
        ? {
            id: randomChat.id,
            chatRoomId: room.id,
            myAlias: aliasForUser(me),
            partnerAlias: otherParticipant
              ? aliasForUser(otherParticipant.userId)
              : null,
            isUnlocked: Boolean(randomChat.unlockedAt),
            endedAt: randomChat.endedAt
              ? randomChat.endedAt.toISOString()
              : null,
            endedReason: randomChat.endedReason || null,
            endedById: randomChat.endedById || null,
            aiEnabled: Boolean(randomChat.aiEnabled),
          }
        : null,
    });
  })
);

router.get(
  '/:id/participants',
  requireAuth,
  asyncHandler(async (req, res) => {
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.set('Pragma', 'no-cache');
    res.set('Expires', '0');
    res.set('Surrogate-Control', 'no-store');

    // Force this endpoint to avoid 304 cached participant responses
    res.set('ETag', `"participants-${Date.now()}-${Math.random()}"`);

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
                preferredLanguage: true,
                autoTranslate: true,
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

// Production room-settings routes. The older /rooms/:id/participants/.../role
// handler is registered only in non-production environments.
router.patch(
  '/:id/participants/:userId/role',
  requireAuth,
  asyncHandler(async (req, res) => {
    const roomId = Number(req.params.id);
    const targetId = Number(req.params.userId);
    const role = String(req.body?.role || '').toUpperCase();
    if (!Number.isSafeInteger(roomId) || roomId <= 0 ||
        !Number.isSafeInteger(targetId) || targetId <= 0) {
      throw Boom.badRequest('Invalid room or participant ID');
    }
    if (!['MEMBER', 'MODERATOR', 'ADMIN'].includes(role)) {
      throw Boom.badRequest('Invalid role');
    }

    const [ownerId, target, actorRank] = await Promise.all([
      getRoomOwnerIdDbTolerant(roomId),
      prisma.participant.findUnique({
        where: { chatRoomId_userId: { chatRoomId: roomId, userId: targetId } },
        select: { userId: true, role: true },
      }),
      getEffectiveRoomRank(prisma, req.user.id, roomId, req.user.role),
    ]);
    if (!target) throw Boom.notFound('Participant not found');
    if (targetId === ownerId) throw Boom.forbidden('Cannot change owner role');
    const targetRank = RoleRank[target.role] ?? RoleRank.MEMBER;
    if (actorRank === null || actorRank < RoleRank.ADMIN ||
        !canActOnRank(actorRank, targetRank)) {
      throw Boom.forbidden('Insufficient room permissions');
    }
    if (role === 'ADMIN' && Number(req.user.id) !== ownerId) {
      throw Boom.forbidden('Only the room owner can grant ADMIN');
    }
    const updated = await prisma.participant.update({
      where: { chatRoomId_userId: { chatRoomId: roomId, userId: targetId } },
      data: { role },
      select: { userId: true, role: true },
    });
    return res.json({ ok: true, participant: updated });
  })
);

router.patch(
  '/:id/ai-assistant',
  requireAuth,
  requireRoomRank(prisma, RoleRank.ADMIN),
  asyncHandler(async (req, res) => {
    const roomId = Number(req.params.id);
    const mode = String(req.body?.mode || '').toUpperCase();
    if (!Number.isSafeInteger(roomId) || roomId <= 0) throw Boom.badRequest('Invalid room ID');
    if (!['OFF', 'MENTION', 'ALWAYS'].includes(mode)) throw Boom.badRequest('Invalid AI mode');
    const updated = await prisma.chatRoom.update({
      where: { id: roomId },
      data: { aiAssistantMode: mode },
      select: { id: true, aiAssistantMode: true, allowForiaBot: true },
    });
    return res.json(updated);
  })
);

// The room-wide AI gate is distinct from each member's personal opt-in.
router.patch(
  '/:id/ai-enabled',
  requireAuth,
  requireRoomRank(prisma, RoleRank.ADMIN),
  asyncHandler(async (req, res) => {
    const roomId = Number(req.params.id);
    if (!Number.isSafeInteger(roomId) || roomId <= 0) throw Boom.badRequest('Invalid room ID');
    if (typeof req.body?.enabled !== 'boolean') throw Boom.badRequest('enabled must be a boolean');
    const updated = await prisma.chatRoom.update({
      where: { id: roomId },
      data: { allowForiaBot: req.body.enabled },
      select: { id: true, aiAssistantMode: true, allowForiaBot: true },
    });
    return res.json(updated);
  })
);

// A participant can only change their own room-level AI consent.
router.patch(
  '/:id/ai-opt',
  requireAuth,
  asyncHandler(async (req, res) => {
    const roomId = Number(req.params.id);
    const userId = Number(req.user.id);
    if (!Number.isSafeInteger(roomId) || roomId <= 0) throw Boom.badRequest('Invalid room ID');
    if (typeof req.body?.allow !== 'boolean') throw Boom.badRequest('allow must be a boolean');
    const result = await prisma.participant.updateMany({
      where: { chatRoomId: roomId, userId },
      data: { allowAIBot: req.body.allow },
    });
    if (result.count !== 1) throw Boom.forbidden('Not a room participant');
    return res.json({ allowAIBot: req.body.allow });
  })
);

router.patch(
  '/:id/auto-translate',
  requireAuth,
  requireRoomRank(prisma, RoleRank.ADMIN),
  asyncHandler(async (req, res) => {
    const roomId = Number(req.params.id);
    const mode = String(req.body?.mode || '').toUpperCase();
    if (!Number.isSafeInteger(roomId) || roomId <= 0) throw Boom.badRequest('Invalid room ID');
    if (!['OFF', 'TAGGED', 'ALL'].includes(mode)) throw Boom.badRequest('Invalid translation mode');
    const updated = await prisma.chatRoom.update({
      where: { id: roomId },
      data: { autoTranslateMode: mode },
      select: { id: true, autoTranslateMode: true },
    });
    return res.json(updated);
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
    await assertDirectUsersAllowed(userId1, userId2);

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

    const existingRooms = await prisma.chatRoom.findMany({
      where: {
        isGroup: false,
        randomChatRoom: {
          is: null,
        },
        AND: [
          { participants: { some: { userId: userId1 } } },
          { participants: { some: { userId: userId2 } } },
        ],
      },
      include: {
        ...participantInclude,
        messages: {
          select: {
            id: true,
            createdAt: true,
          },
          orderBy: {
            createdAt: 'desc',
          },
          take: 1,
        },
      },
    });

    const directUserIds = [userId1, userId2].sort((a, b) => a - b);

    const existingRoom = existingRooms
      .filter((room) => {
        const ids = (room.participants || [])
          .map((p) => Number(p.userId))
          .sort((a, b) => a - b);

        return (
          ids.length === 2 &&
          ids[0] === directUserIds[0] &&
          ids[1] === directUserIds[1]
        );
      })
      .sort((a, b) => {
        const aLast = a.messages?.[0]?.createdAt
          ? new Date(a.messages[0].createdAt).getTime()
          : 0;

        const bLast = b.messages?.[0]?.createdAt
          ? new Date(b.messages[0].createdAt).getTime()
          : 0;

        if (aLast !== bLast) return bLast - aLast;

        return Number(b.id) - Number(a.id);
      })[0];
      
    if (existingRoom) {
      const { messages, ...roomWithoutMessages } = existingRoom;
      return res.json(roomWithoutMessages);
    }

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
    const me = Number(req.user.id);

    if (!Array.isArray(userIds) || userIds.length < 2) {
      throw Boom.badRequest('Provide at least 2 other users for a group chat');
    }

    const ids = [
      ...new Set(
        [me, ...userIds.map(Number)]
          .filter((id) => Number.isFinite(id) && id > 0)
      ),
    ];

    if (ids.length < 3) {
      throw Boom.badRequest('A group chat must have at least 3 total participants');
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
        name: name?.trim() || 'Group chat',
        isGroup: true,
        ownerId: me,
        participants: {
          create: ids.map((id) => ({
            user: { connect: { id } },
            role: id === me ? 'ADMIN' : 'MEMBER',
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
    if (!Number.isSafeInteger(id) || id <= 0) throw Boom.badRequest('Invalid id');

    const member = await prisma.participant.findFirst({
      where: { chatRoomId: id, userId: Number(req.user.id) },
      select: { id: true },
    });
    if (!member) throw Boom.forbidden('Not a participant');

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
      where: { chatRoomId_userId: { chatRoomId: roomId, userId: Number(userId) } },
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
      where: { chatRoomId_userId: { chatRoomId: roomId, userId: targetId } },
      select: { role: true },
    });
    if (!target) return res.json({ ok: true });

    const targetRank = RoleRank[target.role] ?? RoleRank.MEMBER;
    if (!canActOnRank(actorRank, targetRank)) throw Boom.forbidden('Insufficient rank');

    await prisma.participant.delete({
      where: { chatRoomId_userId: { chatRoomId: roomId, userId: targetId } },
    });

    // Evict every active device for this user from the group Socket.IO room.
    // Applies across nodes when the Socket.IO Redis adapter is configured.
    const io = getIo();
    if (io) {
      try {
        await io.in(`user:${targetId}`).socketsLeave(String(roomId));
      } catch (error) {
        console.error('[chatrooms] failed to evict removed participant from live room', {
          roomId, targetId, error,
        });
        throw Boom.serverUnavailable('Membership removed; live room revocation needs attention');
      }
    }

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
    if (!Number.isSafeInteger(id) || id <= 0) throw Boom.badRequest('Invalid id');

    const member = await prisma.participant.findFirst({
      where: { chatRoomId: id, userId: Number(req.user.id) },
      select: { id: true },
    });
    if (!member) throw Boom.forbidden('Not a participant');

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
  requireRoomRank(prisma, RoleRank.ADMIN),
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
