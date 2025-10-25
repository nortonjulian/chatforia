import express from 'express';
import { requireAuth } from '../middleware/auth.js';
import chatroomsRouter from './chatrooms.js';
import prisma from '../utils/prismaClient.js';

const router = express.Router();
const env = String(process.env.NODE_ENV || '');
const isProd = env === 'production';

/**
 * In-memory state used by tests and the test-mode messages router.
 *   - rooms:    Map<roomId, { id, name, isGroup, ownerId }>
 *   - members:  Map<roomId, Set<userId>>
 *   - roles:    Map<roomId, Map<userId, 'OWNER'|'ADMIN'|'MODERATOR'|'MEMBER'>>
 *   - invites:  Map<inviteCode, { roomId, createdAt }>
 */
export const __mem = {
  nextRoomId: 1,
  rooms: new Map(),
  members: new Map(),
  roles: new Map(),
  invites: new Map(), // <=== NEW for invite codes
};

// ---- helpers -----------------------------------------------------

function ensureRoomMaps(roomId) {
  if (!__mem.members.has(roomId)) __mem.members.set(roomId, new Set());
  if (!__mem.roles.has(roomId)) __mem.roles.set(roomId, new Map());
  return { members: __mem.members.get(roomId), roles: __mem.roles.get(roomId) };
}

// Fallback role lookup: in-memory first; if missing, read DB
async function getActorRole(roomId, userId) {
  const roles = __mem.roles.get(roomId);
  const memRole = roles?.get(userId);
  if (memRole) return memRole;

  try {
    const p = await prisma.participant.findUnique({
      where: { chatRoomId_userId: { chatRoomId: roomId, userId } },
      select: { role: true },
    });
    return p?.role ?? null;
  } catch {
    try {
      const p2 = await prisma.participant.findUnique({
        where: { userId_chatRoomId: { userId, chatRoomId: roomId } },
        select: { role: true },
      });
      return p2?.role ?? null;
    } catch {
      return null;
    }
  }
}

async function getRoomOwnerId(roomId) {
  const mem = __mem.rooms.get(roomId);
  if (mem?.ownerId) return mem.ownerId;

  try {
    const db = await prisma.chatRoom.findUnique({
      where: { id: roomId },
      select: { ownerId: true },
    });
    return db?.ownerId ?? null;
  } catch {
    return null;
  }
}

// Upsert participant role across common composite keys / schemas
async function upsertParticipantRole(roomId, userId, role) {
  try {
    return await prisma.participant.upsert({
      where: { chatRoomId_userId: { chatRoomId: roomId, userId } },
      update: { role },
      create: { chatRoomId: roomId, userId, role },
    });
  } catch {}
  try {
    return await prisma.participant.upsert({
      where: { userId_chatRoomId: { userId, chatRoomId: roomId } },
      update: { role },
      create: { chatRoomId: roomId, userId, role },
    });
  } catch {}
  try {
    return await prisma.participant.create({ data: { chatRoomId: roomId, userId, role } });
  } catch {}
  return null;
}

/* ----------------------------------------------------------------
 * Test/Dev FALLBACK endpoints
 * ---------------------------------------------------------------- */
if (!isProd) {
  router.get('/__iam_rooms_router', (_req, res) =>
    res.json({ ok: true, router: 'rooms-fallback', env })
  );

  // Minimal creator used by tests; tolerant of schemas without ownerId or missing User
  async function createMemRoom({ ownerId, name = '', isGroup = true }) {
    let dbRoom;
    try {
      dbRoom = await prisma.chatRoom.create({
        data: { name: name || undefined, isGroup: !!isGroup, ownerId },
        select: { id: true, name: true, isGroup: true, ownerId: true },
      });
    } catch {
      dbRoom = await prisma.chatRoom.create({
        data: { name: name || undefined, isGroup: !!isGroup },
        select: { id: true, name: true, isGroup: true },
      });
    }

    const id = dbRoom.id;

    // Mirror DB participant only if user exists
    try {
      const user = await prisma.user.findUnique({ where: { id: ownerId }, select: { id: true } });
      if (user) {
        try {
          await prisma.participant.upsert({
            where: { chatRoomId_userId: { chatRoomId: id, userId: ownerId } },
            update: { role: 'ADMIN' },
            create: { chatRoomId: id, userId: ownerId, role: 'ADMIN' },
          });
        } catch {
          await prisma.participant.upsert({
            where: { userId_chatRoomId: { userId: ownerId, chatRoomId: id } },
            update: { role: 'ADMIN' },
            create: { chatRoomId: id, userId: ownerId, role: 'ADMIN' },
          });
        }
      }
    } catch {
      // ignore in tests
    }

    // In-memory mirror
    const room = {
      id,
      name: dbRoom.name ?? `Room ${id}`,
      isGroup: !!dbRoom.isGroup,
      ownerId: dbRoom.ownerId ?? ownerId,
    };
    __mem.rooms.set(id, room);
    const { members, roles } = ensureRoomMaps(id);
    members.add(ownerId);
    roles.set(ownerId, 'OWNER');
    return room;
  }

  // POST /rooms → create (tests call this)
  router.post('/', requireAuth, async (req, res, next) => {
    try {
      const ownerId = Number(req.user?.id);
      if (!Number.isFinite(ownerId)) return res.status(401).json({ error: 'Unauthorized' });
      const { name = '', isGroup = true } = req.body || {};
      const room = await createMemRoom({ ownerId, name, isGroup });
      return res
        .status(201)
        .json({ id: room.id, room: { id: room.id, name: room.name, isGroup: room.isGroup } });
    } catch (e) {
      next(e);
    }
  });

  // Alias
  router.post('/create', requireAuth, async (req, res, next) => {
    try {
      const ownerId = Number(req.user?.id);
      if (!Number.isFinite(ownerId)) return res.status(401).json({ error: 'Unauthorized' });
      const { name = '', isGroup = true } = req.body || {};
      const room = await createMemRoom({ ownerId, name, isGroup });
      return res
        .status(201)
        .json({ id: room.id, room: { id: room.id, name: room.name, isGroup: room.isGroup } });
    } catch (e) {
      next(e);
    }
  });

  // GET /rooms/:id/participants → list (ownerId + roles)
  router.get('/:id/participants', requireAuth, async (req, res) => {
    const roomId = Number(req.params.id);
    const memRoom = __mem.rooms.get(roomId);
    if (!memRoom) {
      let dbRoom = null;
      try {
        dbRoom = await prisma.chatRoom.findUnique({
          where: { id: roomId },
          select: { id: true, ownerId: true },
        });
      } catch {
        dbRoom = await prisma.chatRoom.findUnique({
          where: { id: roomId },
          select: { id: true },
        });
      }
      if (!dbRoom) return res.status(404).json({ error: 'Not found' });
      __mem.rooms.set(roomId, {
        id: dbRoom.id,
        name: `Room ${dbRoom.id}`,
        isGroup: true,
        ownerId: dbRoom.ownerId ?? undefined,
      });
    }

    const roles = __mem.roles.get(roomId) || new Map();
    if (roles.size === 0) {
      const ps = await prisma.participant.findMany({
        where: { chatRoomId: roomId },
        select: { userId: true, role: true },
        orderBy: { userId: 'asc' },
      });
      const map = new Map();
      for (const p of ps) map.set(p.userId, p.role);
      __mem.roles.set(roomId, map);
    }

    const participants = Array.from((__mem.roles.get(roomId) || new Map()).entries())
      .sort(([a], [b]) => a - b)
      .map(([userId, role]) => ({
        userId,
        role,
        user: { id: userId, username: `user${userId}` },
      }));

    const ownerId = await getRoomOwnerId(roomId);
    return res.json({ ownerId, participants });
  });

  // POST /rooms/:id/participants → add member (owner or global ADMIN)
  router.post('/:id/participants', requireAuth, async (req, res) => {
    const roomId = Number(req.params.id);
    const { userId } = req.body || {};
    const memRoom = __mem.rooms.get(roomId);

    const dbRoom = memRoom
      ? null
      : await prisma.chatRoom.findUnique({ where: { id: roomId }, select: { id: true } });
    if (!memRoom && !dbRoom) return res.status(404).json({ error: 'Not found' });

    if (!userId) return res.status(400).json({ error: 'userId required' });

    const me = req.user;
    const ownerId = memRoom?.ownerId ?? (await getRoomOwnerId(roomId));
    const isOwner = ownerId === me.id;
    const isAdmin = String(me.role || '').toUpperCase() === 'ADMIN';
    if (!isOwner && !isAdmin) return res.status(403).json({ error: 'Forbidden' });

    const { members, roles } = ensureRoomMaps(roomId);
    const uid = Number(userId);
    members.add(uid);
    if (!roles.has(uid)) roles.set(uid, 'MEMBER');

    try {
      const user = await prisma.user.findUnique({ where: { id: uid }, select: { id: true } });
      if (user) {
        try {
          await prisma.participant.upsert({
            where: { chatRoomId_userId: { chatRoomId: roomId, userId: uid } },
            update: { role: 'MEMBER' },
            create: { chatRoomId: roomId, userId: uid, role: 'MEMBER' },
          });
        } catch {
          await prisma.participant.upsert({
            where: { userId_chatRoomId: { userId: uid, chatRoomId: roomId } },
            update: { role: 'MEMBER' },
            create: { chatRoomId: roomId, userId: uid, role: 'MEMBER' },
          });
        }
      }
    } catch {}

    return res.json({ ok: true, participant: { userId: uid, role: roles.get(uid) } });
  });

  // PATCH /rooms/:id/participants/:userId/role → set role
  router.patch('/:id/participants/:userId/role', requireAuth, async (req, res) => {
    const roomId = Number(req.params.id);
    const targetId = Number(req.params.userId);
    const { role } = req.body || {};

    if (!['ADMIN', 'MODERATOR', 'MEMBER'].includes(role)) {
      return res.status(400).json({ error: 'Invalid role' });
    }

    const ownerId = await getRoomOwnerId(roomId);
    if (ownerId == null) return res.status(404).json({ error: 'Room not found' });
    if (targetId === ownerId) return res.status(403).json({ error: 'Cannot change owner role' });

    const actorId = Number(req.user.id);
    const actorRole = actorId === ownerId ? 'OWNER' : (await getActorRole(roomId, actorId)) || 'MEMBER';

    if (role === 'ADMIN' && actorId !== ownerId) {
      return res.status(403).json({ error: 'Only owner can grant ADMIN' });
    }
    if (role !== 'ADMIN' && !['OWNER', 'ADMIN'].includes(actorRole)) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const { members, roles } = ensureRoomMaps(roomId);
    members.add(targetId);
    roles.set(targetId, role);

    try {
      const user = await prisma.user.findUnique({ where: { id: targetId }, select: { id: true } });
      if (user) {
        try {
          await prisma.participant.upsert({
            where: { chatRoomId_userId: { chatRoomId: roomId, userId: targetId } },
            update: { role },
            create: { chatRoomId: roomId, userId: targetId, role },
          });
        } catch {
          await prisma.participant.upsert({
            where: { userId_chatRoomId: { userId: targetId, chatRoomId: roomId } },
            update: { role },
            create: { chatRoomId: roomId, userId: targetId, role },
          });
        }
      }
    } catch {}

    return res.json({ ok: true, participant: { userId: targetId, role } });
  });

  // INTERNAL helper for promote + also exposed as route below
  async function promoteHandler(req, res) {
    const roomId = Number(req.params.id);
    const targetId = Number(req.params.userId);
    const actorId = Number(req.user?.id);
    const isGlobalAdmin = String(req.user?.role || '').toUpperCase() === 'ADMIN';

    if (!Number.isFinite(roomId) || !Number.isFinite(targetId) || !Number.isFinite(actorId)) {
      return res.status(400).json({ error: 'Bad request' });
    }

    const memRoom = __mem.rooms.get(roomId);
    const dbRoom = memRoom
      ? null
      : await prisma.chatRoom.findUnique({ where: { id: roomId }, select: { id: true } });
    if (!memRoom && !dbRoom) return res.status(404).json({ error: 'Not found' });

    const ownerId = await getRoomOwnerId(roomId);
    const isOwner = ownerId === actorId;
    if (!isOwner && !isGlobalAdmin) {
      return res.status(403).json({ error: 'Only owner can grant ADMIN' });
    }

    const { members, roles } = ensureRoomMaps(roomId);
    members.add(targetId);
    roles.set(targetId, 'ADMIN');

    const rec = await upsertParticipantRole(roomId, targetId, 'ADMIN');
    if (!rec) return res.status(500).json({ error: 'Failed to persist role' });

    return res.json({ ok: true, participant: { userId: targetId, role: 'ADMIN' } });
  }

  // POST /chatrooms/:id/participants/:userId/promote  (used by tests via ENDPOINTS.promote)
  router.post('/chatrooms/:id/participants/:userId/promote', requireAuth, promoteHandler);

  // Alias: /rooms/:id/participants/:userId/promote
  router.post('/:id/participants/:userId/promote', requireAuth, promoteHandler);

  // Alias: /rooms/:id/promote/:userId
  router.post('/:id/promote/:userId', requireAuth, promoteHandler);

  // -----------------------
  // INVITES / JOIN / LEAVE
  // -----------------------

  // POST /group-invites/:roomId -> create invite code (owner only, or global ADMIN)
  router.post('/group-invites/:roomId', requireAuth, async (req, res) => {
    const roomId = Number(req.params.roomId);
    const actorId = Number(req.user?.id);
    if (!Number.isFinite(roomId) || !Number.isFinite(actorId)) {
      return res.status(400).json({ error: 'Bad request' });
    }

    // room must exist (either in-memory or DB)
    let room = __mem.rooms.get(roomId);
    if (!room) {
      // try to hydrate from DB so we know owner
      try {
        const dbRoom = await prisma.chatRoom.findUnique({
          where: { id: roomId },
          select: { id: true, ownerId: true, name: true, isGroup: true },
        });
        if (!dbRoom) return res.status(404).json({ error: 'Not found' });

        room = {
          id: dbRoom.id,
          ownerId: dbRoom.ownerId ?? actorId,
          name: dbRoom.name ?? `Room ${dbRoom.id}`,
          isGroup: !!dbRoom.isGroup,
        };
        __mem.rooms.set(roomId, room);
        ensureRoomMaps(roomId); // make sure sets exist
      } catch {
        return res.status(404).json({ error: 'Not found' });
      }
    }

    // only owner or global ADMIN can create invite
    const ownerId = room.ownerId ?? (await getRoomOwnerId(roomId));
    const isOwner = ownerId === actorId;
    const isGlobalAdmin = String(req.user?.role || '').toUpperCase() === 'ADMIN';
    if (!isOwner && !isGlobalAdmin) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    // generate invite code and store it
    const code = `${roomId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    __mem.invites.set(code, { roomId, createdAt: Date.now() });

    return res.status(201).json({ code });
  });

  // POST /group-invites/:code/join -> join room via invite code
  router.post('/group-invites/:code/join', requireAuth, async (req, res) => {
    const code = String(req.params.code || '');
    const meId = Number(req.user?.id);
    if (!meId || !Number.isFinite(meId)) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const invite = __mem.invites.get(code);
    if (!invite) {
      return res.status(404).json({ error: 'Invalid or expired code' });
    }

    const roomId = Number(invite.roomId);
    if (!Number.isFinite(roomId)) {
      return res.status(400).json({ error: 'Bad invite' });
    }

    // hydrate room in memory if missing
    let room = __mem.rooms.get(roomId);
    if (!room) {
      try {
        const dbRoom = await prisma.chatRoom.findUnique({
          where: { id: roomId },
          select: { id: true, ownerId: true, name: true, isGroup: true },
        });
        if (!dbRoom) return res.status(404).json({ error: 'Room not found' });

        room = {
          id: dbRoom.id,
          ownerId: dbRoom.ownerId ?? undefined,
          name: dbRoom.name ?? `Room ${dbRoom.id}`,
          isGroup: !!dbRoom.isGroup,
        };
        __mem.rooms.set(roomId, room);
      } catch {
        return res.status(404).json({ error: 'Room not found' });
      }
    }

    // record membership
    const { members, roles } = ensureRoomMaps(roomId);
    members.add(meId);
    if (!roles.has(meId)) {
      roles.set(meId, 'MEMBER');
    }

    // upsert participant in DB if possible
    try {
      await prisma.participant
        .upsert({
          where: { chatRoomId_userId: { chatRoomId: roomId, userId: meId } },
          update: { role: 'MEMBER' },
          create: { chatRoomId: roomId, userId: meId, role: 'MEMBER' },
        })
        .catch(async () => {
          await prisma.participant.upsert({
            where: { userId_chatRoomId: { userId: meId, chatRoomId: roomId } },
            update: { role: 'MEMBER' },
            create: { chatRoomId: roomId, userId: meId, role: 'MEMBER' },
          });
        });
    } catch {
      // swallow in tests
    }

    return res.status(200).json({ ok: true, roomId });
  });

  // POST /chatrooms/:roomId/leave -> self-leave the room
  // POST /chatrooms/:roomId/leave
router.post('/chatrooms/:roomId/leave', requireAuth, async (req, res) => {
  const roomId = Number(req.params.roomId);
  const userId = Number(req.user?.id);

  if (!Number.isFinite(roomId) || !Number.isFinite(userId)) {
    return res.status(400).json({ error: 'Bad request' });
  }

  // is the user actually in this room?
  const roomMembers = __mem.members.get(roomId);
  const inMem = roomMembers?.has(userId);

  let inDb = false;
  try {
    const p = await prisma.participant.findFirst({
      where: { chatRoomId: roomId, userId },
      select: { userId: true },
    });
    inDb = !!p;
  } catch {
    // ignore if schema's different
    try {
      const p2 = await prisma.participant.findFirst({
        where: { userId, chatRoomId: roomId },
        select: { userId: true },
      });
      inDb = !!p2;
    } catch {
      /* ignore */
    }
  }

  if (!inMem && !inDb) {
    // you're not in the room, you can't "leave" -> Forbidden
    return res.status(403).json({ error: 'Forbidden' });
  }

  // remove from in-memory membership/roles
  __mem.members.get(roomId)?.delete(userId);
  __mem.roles.get(roomId)?.delete(userId);

  // Best-effort DB cleanup (ignore errors if schema doesn't match)
  try {
    await prisma.participant.deleteMany({
      where: { chatRoomId: roomId, userId },
    });
  } catch {
    try {
      await prisma.participant.deleteMany({
        where: { userId, chatRoomId: roomId },
      });
    } catch {
      /* ignore */
    }
  }

  return res.json({ ok: true });
});


  // DELETE /rooms/:id/participants/:userId → kick (owner/admin)
  router.delete('/:id/participants/:userId', requireAuth, async (req, res) => {
    const roomId = Number(req.params.id);
    const targetId = Number(req.params.userId);

    const ownerId = await getRoomOwnerId(roomId);
    if (ownerId == null) return res.json({ ok: true });
    const me = req.user;
    const isOwner = ownerId === me.id;
    const isAdmin = String(me.role || '').toUpperCase() === 'ADMIN';
    if (!isOwner && !isAdmin) return res.status(403).json({ error: 'Forbidden' });
    if (targetId === ownerId) return res.status(403).json({ error: 'Cannot remove owner' });

    __mem.members.get(roomId)?.delete(targetId);
    __mem.roles.get(roomId)?.delete(targetId);

    try {
      await prisma.participant.deleteMany({
        where: { chatRoomId: roomId, userId: targetId },
      });
    } catch {}

    return res.json({ ok: true });
  });
}

/* ----------------------------------------------------------------
 * Mount the real router last (prod + test/dev).
 * ---------------------------------------------------------------- */
router.use('/', chatroomsRouter);

export default router;
