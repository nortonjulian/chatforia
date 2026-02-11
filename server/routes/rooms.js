import express from 'express';
import { requireAuth } from '../middleware/auth.js';
import chatroomsRouter from './chatrooms.js';
import prisma from '../utils/prismaClient.js';
import asyncHandler from 'express-async-handler';

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

router.get('/', asyncHandler(async (req, res) => {
  const rooms = await prisma.chatRoom.findMany({
    orderBy: { updatedAt: 'desc' },
    take: 50,
  });

  return res.json({ rooms });
}));

// GET /chatrooms/:roomId/messages
router.get(
  '/:roomId/messages',
  asyncHandler(async (req, res) => {
    const roomIdRaw = req.params.roomId;
    const roomId = Number(roomIdRaw);

    console.log('🔥 GET /chatrooms/:roomId/messages', { roomIdRaw, roomId });

    if (!Number.isFinite(roomId)) {
      return res.status(400).json({ error: 'Invalid roomId', roomIdRaw });
    }

    try {
      // --- GLOBAL DEBUG (proves if DB has messages at all) ---
      // --- GLOBAL DEBUG ---
      const totalMessages = await prisma.message.count();

      const latest = await prisma.message.findFirst({
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          chatRoomId: true,
          randomChatRoomId: true,
          createdAt: true,
          senderId: true,
        },
      });

      const sampleRoomIds = await prisma.message.findMany({
        distinct: ['chatRoomId'],
        select: { chatRoomId: true },
        take: 10,
      });

      const roomExists = await prisma.chatRoom.findUnique({
        where: { id: roomId },
        select: { id: true, name: true, isGroup: true },
      });

      // DB identity (helps confirm you're hitting the expected database/schema)
      let dbInfo = null;
      try {
        const r = await prisma.$queryRaw`
          SELECT current_database() as db, current_schema() as schema
        `;
        dbInfo = Array.isArray(r) ? (r[0] ?? null) : null;
      } catch {
        // ignore if non-Postgres / restricted / etc.
      }

      const globalDebug = {
        roomId,
        roomExists,
        totalMessages,
        latestMessage: latest,
        sampleChatRoomIdsWithMessages: sampleRoomIds.map((r) => r.chatRoomId),
        dbInfo,
      };

      // --- 1) New schema fetch ---
      const messagesNew = await prisma.message.findMany({
        where: {
          OR: [{ chatRoomId: roomId }, { randomChatRoomId: roomId }],
        },
        orderBy: { createdAt: 'asc' },
        take: 200,
      });

      // counts (cheap + decisive)
      const countChatRoomId = await prisma.message.count({ where: { chatRoomId: roomId } });
      const countRandomChatRoomId = await prisma.message.count({ where: { randomChatRoomId: roomId } });

      // If we have messages in the new schema, return them now
      if (messagesNew.length) {
        console.log('✅ Returning NEW schema messages:', { count: messagesNew.length });
        return res.json({
          messages: messagesNew,
          debug: {
            ...globalDebug,
            countChatRoomId,
            countRandomChatRoomId,
            used: 'new-schema',
          },
        });
      }

      console.warn('⚠️ No messages via NEW schema. Checking for legacy chatId…', {
        roomId,
        countChatRoomId,
        countRandomChatRoomId,
      });

      // --- 2) Detect legacy column existence (Postgres) ---
      let hasChatIdColumn = false;

      try {
        const cols = await prisma.$queryRaw`
          SELECT 1
          FROM information_schema.columns
          WHERE table_schema = 'public'
            AND lower(table_name) = lower('Message')
            AND lower(column_name) IN (lower('chatId'), lower('chat_id'))
          LIMIT 1
        `;
        hasChatIdColumn = Array.isArray(cols) && cols.length > 0;
      } catch (e) {
        console.warn('⚠️ Could not query information_schema (non-Postgres or permissions).', e?.message || e);
      }

      if (!hasChatIdColumn) {
        return res.json({
          messages: [],
          debug: {
            ...globalDebug,
            countChatRoomId,
            countRandomChatRoomId,
            hasChatIdColumn: false,
            used: 'none',
            note:
              'No rows for chatRoomId/randomChatRoomId, and legacy chatId column not detected (or DB is not Postgres).',
          },
        });
      }

      // --- 3) Legacy chatId fallback ---
      // Try both "Message" and "message" table names safely.
      let legacyCount = 0;
      let legacyRows = [];

      try {
        const legacyCountRows = await prisma.$queryRaw`
          SELECT COUNT(*)::int AS count
          FROM "Message"
          WHERE "chatId" = ${roomId}
        `;
        legacyCount = Number(legacyCountRows?.[0]?.count ?? 0);

        legacyRows = await prisma.$queryRaw`
          SELECT
            m."id",
            m."createdAt",
            m."senderId",
            m."chatId" as "chatRoomId",
            m."text" as "rawContent"
          FROM "Message" m
          WHERE m."chatId" = ${roomId}
          ORDER BY m."createdAt" ASC
          LIMIT 200
        `;
      } catch (e1) {
        console.warn('⚠️ Legacy query on "Message" failed, trying "message"...', e1?.message || e1);

        const legacyCountRows2 = await prisma.$queryRaw`
          SELECT COUNT(*)::int AS count
          FROM "message"
          WHERE "chatId" = ${roomId}
        `;
        legacyCount = Number(legacyCountRows2?.[0]?.count ?? 0);

        legacyRows = await prisma.$queryRaw`
          SELECT
            m."id",
            m."createdAt",
            m."senderId",
            m."chatId" as "chatRoomId",
            m."text" as "rawContent"
          FROM "message" m
          WHERE m."chatId" = ${roomId}
          ORDER BY m."createdAt" ASC
          LIMIT 200
        `;
      }

      return res.json({
        messages: legacyRows,
        debug: {
          ...globalDebug,
          countChatRoomId,
          countRandomChatRoomId,
          hasChatIdColumn: true,
          legacyCount,
          used: 'legacy-chatId',
        },
      });
    } catch (e) {
      console.error('❌ chatrooms/:roomId/messages failed', e);
      return res.status(500).json({
        error: 'Failed to fetch messages',
        detail: String(e?.message || e),
      });
    }
  })
);

router.post(
  '/__debug/seed-message',
  asyncHandler(async (req, res) => {
    const roomId = Number(req.body?.roomId ?? 7673);
    const senderId = Number(req.user?.id); // uses your auth middleware

    if (!senderId) return res.status(401).json({ error: 'Not authorized' });
    if (!Number.isFinite(roomId)) return res.status(400).json({ error: 'Invalid roomId' });

    const msg = await prisma.message.create({
      data: {
        chatRoomId: roomId,
        senderId,
        rawContent: `seed test @ ${new Date().toISOString()}`,
        contentCiphertext: "",
        translatedFrom: null,
        translatedTo: null,
        translatedContent: null,
        translations: null,
        isExplicit: false,
        isAutoReply: false,
      },
    });

    return res.json({ ok: true, messageId: msg.id, roomId });
  })
);


// POST /chatrooms/:roomId/messages
router.post(
  '/:roomId/messages',
  asyncHandler(async (req, res) => {
    const roomId = Number(req.params.roomId);
    if (!Number.isFinite(roomId)) return res.status(400).json({ error: 'Invalid roomId' });

    // Auth middleware should set req.user from JWT
    const senderId = Number(req.user?.id);
    if (!senderId) return res.status(401).json({ error: 'Not authorized' });

    const { rawContent, clientMessageId } = req.body || {};
    const text = String(rawContent || '').trim();
    if (!text) return res.status(400).json({ error: 'Message is empty' });

    // ✅ De-dupe (prevents duplicates on retries / double-taps / socket echo)
    // Requires: Message.clientMessageId String? @unique in Prisma
    if (clientMessageId) {
      const existing = await prisma.message.findUnique({
        where: { clientMessageId: String(clientMessageId) },
        include: { sender: { select: { id: true, username: true } } },
      });

      if (existing) {
        return res.json({
          message: {
            id: existing.id,
            chatRoomId: existing.chatRoomId,
            senderId: existing.senderId,
            senderUsername: existing.sender?.username ?? null,

            rawContent: existing.rawContent,
            translatedContent: existing.translatedContent,
            contentCiphertext: existing.contentCiphertext,

            createdAt: existing.createdAt,
            clientMessageId: existing.clientMessageId,
          },
        });
      }
    }

    const message = await prisma.message.create({
      data: {
        chatRoomId: roomId,
        senderId,
        rawContent: text,

        // ✅ Persist clientMessageId for reliable optimistic reconciliation + de-dupe
        clientMessageId: clientMessageId ? String(clientMessageId) : null,

        // placeholders until encryption/translation pipeline is wired
        contentCiphertext: "",   // placeholder until encryption
        translatedFrom: "en",    // optional / placeholder
        translatedTo: null,
        translatedContent: null,
        translations: null,
        isExplicit: false,
        isAutoReply: false,
      },
      include: { sender: { select: { id: true, username: true } } },
    });

    const payload = {
      id: message.id,
      chatRoomId: message.chatRoomId,
      senderId: message.senderId,
      senderUsername: message.sender?.username ?? null,

      rawContent: message.rawContent,
      translatedContent: message.translatedContent,
      contentCiphertext: message.contentCiphertext,

      createdAt: message.createdAt,
      clientMessageId: message.clientMessageId,
    };

    // ✅ 1️⃣ SOCKET.IO BROADCAST (goes HERE)
    const io = req.app.get('io');
    io?.to(String(roomId)).emit('message:new', payload);

    // ✅ Shape response to match what iOS expects (and what GET should resemble)
    return res.json({ message: payload });
  })
);

/* ----------------------------------------------------------------
 * ✅ Option B: "Clear conversation for me"
 * Adds/updates Participant.archivedAt (used as clearedAt)
 * Then messages.js will filter messages where createdAt <= archivedAt.
 *
 * Route:
 *   POST /rooms/:roomId/clear
 * Body (optional):
 *   { alsoArchive: true|false }  // default true; just sets archivedAt regardless
 * Response:
 *   { ok: true, roomId, clearedAt }
 * ---------------------------------------------------------------- */
router.post('/:roomId/clear', requireAuth, async (req, res) => {
  const roomId = Number(req.params.roomId);
  const userId = Number(req.user?.id);

  if (!Number.isFinite(roomId) || !Number.isFinite(userId)) {
    return res.status(400).json({ error: 'Bad request' });
  }

  const clearedAt = new Date();

  // --- TEST/DEV in-memory support ---
  if (!isProd) {
    const { members } = ensureRoomMaps(roomId);

    // allow clear only if you're in the room (mem) OR DB says you're a participant
    const inMem = members.has(userId);
    let inDb = false;

    if (!inMem) {
      try {
        const p = await prisma.participant.findFirst({
          where: { chatRoomId: roomId, userId },
          select: { id: true },
        });
        inDb = !!p;
      } catch {
        try {
          const p2 = await prisma.participant.findFirst({
            where: { userId, chatRoomId: roomId },
            select: { id: true },
          });
          inDb = !!p2;
        } catch {
          /* ignore */
        }
      }
    }

    if (!inMem && !inDb) return res.status(403).json({ error: 'Forbidden' });

    // store per-user clearedAt in mem (so tests can observe it if needed)
    if (!__mem.clearedAt) __mem.clearedAt = new Map(); // roomId -> Map<userId, isoString>
    if (!__mem.clearedAt.has(roomId)) __mem.clearedAt.set(roomId, new Map());
    __mem.clearedAt.get(roomId).set(userId, clearedAt.toISOString());
  }

  // --- DB: set Participant.archivedAt = clearedAt ---
  // (we're using archivedAt as the "clearedAt" marker)
  let updated = null;

  try {
    updated = await prisma.participant.update({
      where: { chatRoomId_userId: { chatRoomId: roomId, userId } },
      data: { archivedAt: clearedAt },
      select: { chatRoomId: true, userId: true, archivedAt: true },
    });
  } catch {
    // alt composite key OR row missing -> try upsert paths
    try {
      updated = await prisma.participant.update({
        where: { userId_chatRoomId: { userId, chatRoomId: roomId } },
        data: { archivedAt: clearedAt },
        select: { chatRoomId: true, userId: true, archivedAt: true },
      });
    } catch {
      try {
        // if they are a participant but schema key mismatch, upsert w/ best-effort
        updated = await prisma.participant.upsert({
          where: { chatRoomId_userId: { chatRoomId: roomId, userId } },
          update: { archivedAt: clearedAt },
          create: { chatRoomId: roomId, userId, archivedAt: clearedAt },
          select: { chatRoomId: true, userId: true, archivedAt: true },
        });
      } catch {
        try {
          updated = await prisma.participant.upsert({
            where: { userId_chatRoomId: { userId, chatRoomId: roomId } },
            update: { archivedAt: clearedAt },
            create: { chatRoomId: roomId, userId, archivedAt: clearedAt },
            select: { chatRoomId: true, userId: true, archivedAt: true },
          });
        } catch (e) {
          console.error('[rooms:clear] failed to persist archivedAt', e);
          return res.status(500).json({ error: 'Failed to clear conversation' });
        }
      }
    }
  }

  // Optional: notify this user’s other devices
  // (We emit to a user-room if you have one, otherwise no-op)
  try {
    const io = req.app.get('io');
    io?.to(`user:${userId}`).emit('thread_cleared', {
      roomId,
      userId,
      clearedAt: clearedAt.toISOString(),
    });
  } catch {
    // ignore
  }

  return res.json({
    ok: true,
    roomId,
    clearedAt: (updated?.archivedAt || clearedAt).toISOString?.()
      ? updated.archivedAt.toISOString()
      : String(updated?.archivedAt || clearedAt),
  });
});

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
    const actorRole =
      actorId === ownerId ? 'OWNER' : (await getActorRole(roomId, actorId)) || 'MEMBER';

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
