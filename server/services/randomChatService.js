import { activeRandomRoomForSocket, endRandomRoom, expireRandomRoomIfNeeded } from './randomChatLifecycle.js';

const DESCRIPTORS = [
  "Calm",
  "Quiet",
  "Bright",
  "Golden",
  "Soft",
  "Neon",
  "LateNight",
  "Early",
  "Chill",
  "Warm",
  "Cool",
  "Swift",
  "Gentle",
  "Bold",
  "Curious",
  "Open",
  "Hidden",
  "Lively",
  "Silent",
  "Electric",
];

const CORES = [
  "Signal",
  "Echo",
  "Pulse",
  "Wave",
  "Horizon",
  "Drift",
  "Flow",
  "Vibe",
  "Thread",
  "Link",
  "Voice",
  "Channel",
  "Spark",
  "Loop",
  "Path",
  "Moment",
  "Stream",
  "Bridge",
  "Node",
  "Beat",
];

function randomItem(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function generateAlias(existing = new Set()) {
  let tries = 0;

  while (tries < 50) {
    const descriptor = randomItem(DESCRIPTORS);
    const core = randomItem(CORES);

    // 🔥 4-digit ID = 10,000 possibilities per combo
    const id = Math.floor(Math.random() * 10000)
      .toString()
      .padStart(4, "0");

    const alias = `${descriptor} ${core} ${id}`;

    if (!existing.has(alias)) {
      return alias;
    }

    tries++;
  }

  return `User ${Date.now().toString().slice(-4)}`;
}

export function buildQueues() {
  return {
    waitingQueue: [],                 // [{ socketId, userId, username, ageBand, wantsAgeFilter }]
    waitingBySocket: new Map(),       // socketId -> entry
    activeRoomBySocket: new Map(),    // socketId -> { roomId, peerSocketId, peerUserId }
    sessionByRoomId: new Map(),       // roomId -> session metadata
  };
}

const AGE_BANDS = new Map([
  ['TEEN_13_17', 'TEEN_13_17'],
  ['ADULT_18_24', 'ADULT_18_24'],
  ['ADULT_25_34', 'ADULT_25_34'],
  ['ADULT_35_49', 'ADULT_35_49'],
  ['ADULT_50_PLUS', 'ADULT_50_PLUS'],
  // Historical test-fixture / imported preference representations.
  ['13-17', 'TEEN_13_17'],
  ['18-24', 'ADULT_18_24'],
  ['25-34', 'ADULT_25_34'],
  ['35-49', 'ADULT_35_49'],
  ['50+', 'ADULT_50_PLUS'],
]);

const ageBandFor = (entry) => AGE_BANDS.get(String(entry?.ageBand ?? '')) ?? null;

export function areCompatible(a, b) {
  if (!a || !b || String(a.userId) === String(b.userId)) return false;

  const aBand = ageBandFor(a);
  const bBand = ageBandFor(b);
  // Unknown/unattested age must never be matched to someone else.
  if (!aBand || !bBand) return false;

  // Non-negotiable separation: minors can match only minors.
  if ((aBand === 'TEEN_13_17') !== (bBand === 'TEEN_13_17')) return false;

  // Preserve existing optional stricter age filtering among adults.
  if ((a.wantsAgeFilter || b.wantsAgeFilter) && aBand !== bBand) return false;

  // A configured allow-list is respected on BOTH sides; empty lists follow
  // existing adult matching defaults until product policy is confirmed.
  const allowedA = Array.isArray(a.randomChatAllowedBands) ? a.randomChatAllowedBands : [];
  const allowedB = Array.isArray(b.randomChatAllowedBands) ? b.randomChatAllowedBands : [];
  if (allowedA.length && !allowedA.some((band) => AGE_BANDS.get(String(band)) === bBand)) return false;
  if (allowedB.length && !allowedB.some((band) => AGE_BANDS.get(String(band)) === aBand)) return false;
  return true;
}

export function enqueue(queues, entry) {
  queues.waitingQueue.push(entry);
  queues.waitingBySocket.set(entry.socketId, entry);
}

export function removeFromQueue(queues, socketId) {
  if (!queues.waitingBySocket.has(socketId)) return null;

  const entry = queues.waitingBySocket.get(socketId);
  queues.waitingBySocket.delete(socketId);

  const idx = queues.waitingQueue.findIndex((e) => e.socketId === socketId);
  if (idx >= 0) queues.waitingQueue.splice(idx, 1);

  return entry;
}

export async function createRandomRoom(prisma, userA, userB) {
  const systemIntro = `You've been paired for a random chat. Be kind!`;

  const aliasA = generateAlias(new Set());
  const used = new Set([aliasA]);
  const aliasB = generateAlias(used);

  const aliasByUser = {
    [userA.userId]: aliasA,
    [userB.userId]: aliasB,
  };

  const result = await prisma.$transaction(async (tx) => {
    const chatRoom = await tx.chatRoom.create({
      data: {
        isGroup: false,
        participants: {
          create: [
            {
              user: { connect: { id: userA.userId } },
              role: "MEMBER",
            },
            {
              user: { connect: { id: userB.userId } },
              role: "MEMBER",
            },
          ],
        },
      },
    });

    const randomRoom = await tx.randomChatRoom.create({
      data: {
        chatRoom: {
          connect: { id: chatRoom.id },
        },
        participants: {
          connect: [{ id: userA.userId }, { id: userB.userId }],
        },
        aliasByUser,
        connections: {
          create: [
            { userId: Number(userA.userId), socketId: userA.socketId },
            { userId: Number(userB.userId), socketId: userB.socketId },
          ],
        },
        messages: {
          create: [
            {
              rawContent: systemIntro,
              sender: { connect: { id: userA.userId } },
              chatRoom: { connect: { id: chatRoom.id } },
            },
          ],
        },
      },
      include: {
        participants: true,
        messages: {
          include: {
            sender: true,
          },
        },
      },
    });

    return {
      ...randomRoom,
      id: chatRoom.id,
      chatRoomId: chatRoom.id,
      randomChatRoomId: randomRoom.id,
      aliasByUser,
    };
  });

  return result;
}


export function getSessionForSocket(queues, socketId) {
  const active = queues.activeRoomBySocket.get(socketId);
  if (!active) return null;

  const session = queues.sessionByRoomId.get(active.roomId);
  return session || null;
}

export function getSessionForRoom(queues, roomId) {
  return queues.sessionByRoomId.get(roomId) || null;
}

export function getPeerMeta(queues, socketId) {
  return queues.activeRoomBySocket.get(socketId) || null;
}

export function clearActiveRoom(queues, socketId) {
  const active = queues.activeRoomBySocket.get(socketId);
  if (!active) return null;

  queues.activeRoomBySocket.delete(socketId);
  return active;
}

export function cleanupRoomSessionIfOrphaned(queues, roomId) {
  let stillActive = false;

  for (const meta of queues.activeRoomBySocket.values()) {
    if (meta.roomId === roomId) {
      stillActive = true;
      break;
    }
  }

  if (!stillActive) {
    queues.sessionByRoomId.delete(roomId);
  }
}

async function emitMatched(prisma, io, roomId, session, userA, userB) {
  const chan = `random:${roomId}`;

  const [contactA, contactB] = await Promise.all([
    prisma.contact.findUnique({
      where: {
        ownerId_userId: {
          ownerId: userA.userId,
          userId: userB.userId,
        },
      },
    }),
    prisma.contact.findUnique({
      where: {
        ownerId_userId: {
          ownerId: userB.userId,
          userId: userA.userId,
        },
      },
    }),
  ]);

  const aliasForA = session.users[userA.userId].alias;
  const aliasForB = session.users[userB.userId].alias;

  const socketA = io.sockets.sockets.get(userA.socketId);
  const socketB = io.sockets.sockets.get(userB.socketId);

  if (socketA) {
    socketA.join(chan);
    socketA.emit("random:matched", {
      roomId,
      chatRoomId: roomId,
      randomChatRoomId: session.randomChatRoomId,
      myAlias: session.users[userA.userId].alias,
      partnerAlias: session.users[userB.userId].alias,
      partnerDisplayName: session.users[userB.userId].alias,
      relationshipStatus: contactA ? "friends" : "none",
    });
  }

  if (socketB) {
    socketB.join(chan);
    socketB.emit("random:matched", {
      roomId,
      chatRoomId: roomId,
      randomChatRoomId: session.randomChatRoomId,
      myAlias: aliasForB,
      partnerAlias: aliasForA,
      partnerDisplayName: aliasForA,
      relationshipStatus: contactB ? "friends" : "none",
    });
  }
}

/**
 * Attempts to match currentEntry against FIFO waiting queue.
 * - If no peer: enqueues and emits waiting
 * - If peer: creates DB room, joins sockets to io room, emits random:matched
 */
export async function tryMatch({ queues, prisma, io, currentEntry, getSocketById }) {
  if (!ageBandFor(currentEntry)) {
    throw new Error('An attested age band is required for human Random Chat');
  }
  let peerIdx = -1;
  for (let i = 0; i < queues.waitingQueue.length; i++) {
    const candidate = queues.waitingQueue[i];
    if (!areCompatible(currentEntry, candidate)) continue;
    if (typeof prisma.userBlock?.findFirst !== 'function') {
      throw new Error('Account-blocking enforcement is unavailable');
    }
    // A database failure must not silently allow a blocked pair to match.
    const block = await prisma.userBlock.findFirst({
      where: {
        OR: [
          { blockerId: Number(currentEntry.userId), blockedId: Number(candidate.userId) },
          { blockerId: Number(candidate.userId), blockedId: Number(currentEntry.userId) },
        ],
      },
      select: { id: true },
    });
    if (!block) {
      peerIdx = queues.waitingQueue.findIndex((entry) => entry.socketId === candidate.socketId);
      if (peerIdx !== -1) break;
    }
  }

  if (peerIdx === -1) {
    enqueue(queues, currentEntry);
    const socket = getSocketById(currentEntry.socketId);
    if (socket) socket.emit("random:waiting", { message: "Looking for a partner…" });
    return { matched: false };
  }

  const peerEntry = queues.waitingQueue[peerIdx];
  if (!getSocketById(currentEntry.socketId)) return { matched: false };
  if (!getSocketById(peerEntry.socketId)) {
    removeFromQueue(queues, peerEntry.socketId);
    enqueue(queues, currentEntry);
    getSocketById(currentEntry.socketId)?.emit('random:waiting', {
      message: 'Looking for a partner…',
    });
    return { matched: false };
  }

  // Remove peer from queue
  queues.waitingQueue.splice(peerIdx, 1);
  queues.waitingBySocket.delete(peerEntry.socketId);

  const room = await createRandomRoom(prisma, currentEntry, peerEntry);

  queues.activeRoomBySocket.set(currentEntry.socketId, {
    roomId: room.chatRoomId,
    randomChatRoomId: room.randomChatRoomId,
    userId: currentEntry.userId,
    peerSocketId: peerEntry.socketId,
    peerUserId: peerEntry.userId,
  });

  queues.activeRoomBySocket.set(peerEntry.socketId, {
    roomId: room.chatRoomId,
    randomChatRoomId: room.randomChatRoomId,
    userId: peerEntry.userId,
    peerSocketId: currentEntry.socketId,
    peerUserId: currentEntry.userId,
  });

  const session = {
    roomId: room.chatRoomId,
    randomChatRoomId: room.randomChatRoomId,
    users: {
      [currentEntry.userId]: {
        userId: currentEntry.userId,
        socketId: currentEntry.socketId,
        username: currentEntry.username,
        alias: room.aliasByUser[currentEntry.userId],
        requestedFriend: false,
      },
      [peerEntry.userId]: {
        userId: peerEntry.userId,
        socketId: peerEntry.socketId,
        username: peerEntry.username,
        alias: room.aliasByUser[peerEntry.userId],
        requestedFriend: false,
      },
    },
    isUnlocked: false,
    createdAt: new Date(),
  };

  queues.sessionByRoomId.set(room.chatRoomId, session);

  await emitMatched(prisma, io, room.chatRoomId, session, currentEntry, peerEntry);

  return {
    matched: true,
    roomId: room.chatRoomId,
    chatRoomId: room.chatRoomId,
    randomChatRoomId: room.randomChatRoomId,
    myAlias: session.users[currentEntry.userId].alias,
    partnerAlias: session.users[peerEntry.userId].alias,
  };
}

async function ensureMutualContacts(prisma, userA, userB) {
    const existingA = await prisma.contact.findUnique({
      where: {
        ownerId_userId: {
          ownerId: userA.userId,
          userId: userB.userId,
        },
      },
    });

    if (!existingA) {
      await prisma.contact.create({
        data: {
          ownerId: userA.userId,
          userId: userB.userId,
          alias: userB.username || null,
        },
      });
    }

    const existingB = await prisma.contact.findUnique({
      where: {
        ownerId_userId: {
          ownerId: userB.userId,
          userId: userA.userId,
        },
      },
    });

    if (!existingB) {
      await prisma.contact.create({
        data: {
          ownerId: userB.userId,
          userId: userA.userId,
          alias: userA.username || null,
        },
      });
    }
}

/**
 * Marks that a user in a random room requested "Add Friend".
 * When both sides request it, usernames become unlocked.
 */
export async function requestAddFriend({ queues, io, prisma, roomId, userId, socketId }) {
  const room = await activeRandomRoomForSocket(prisma, userId, socketId);
  if (!room || Number(room.chatRoomId) !== Number(roomId) ||
      await expireRandomRoomIfNeeded({ prisma, io, room })) {
    return { ok: false, reason: 'not_in_active_random_room' };
  }
  const peer = room.connections.find((entry) => entry.userId !== Number(userId));
  const blocked = peer && await prisma.userBlock.findFirst({
    where: { OR: [
      { blockerId: Number(userId), blockedId: peer.userId },
      { blockerId: peer.userId, blockedId: Number(userId) },
    ] },
    select: { id: true },
  });
  if (blocked) {
    await endRandomRoom({ prisma, io, room, reason: 'account_blocked' });
    return { ok: false, reason: 'account_blocked' };
  }
  const request = await prisma.randomChatConnection.updateMany({
    where: { randomChatRoomId: room.id, userId: Number(userId), socketId, active: true },
    data: { friendRequestedAt: new Date() },
  });
  if (request.count !== 1) return { ok: false, reason: 'stale_socket' };
  const participants = await prisma.randomChatConnection.findMany({
    where: { randomChatRoomId: room.id, active: true },
    include: { user: { select: { id: true, username: true } } },
  });
  if (participants.length !== 2 || !participants.every((entry) => entry.friendRequestedAt)) {
    return { ok: true, unlocked: false };
  }
  const [userA, userB] = participants.map((entry) => ({
    userId: entry.userId, username: entry.user.username,
  }));
  const directRoom = await prisma.$transaction(async (tx) => {
    const result = await tx.randomChatRoom.updateMany({
      where: { id: room.id, endedAt: null, unlockedAt: null },
      data: { unlockedAt: new Date() },
    });
    if (result.count !== 1) return null;
    const direct = await createOrOpenDirectChatRoom(tx, userA.userId, userB.userId);
    await ensureMutualContacts(tx, userA, userB);
    await tx.randomChatConnection.updateMany({
      where: { randomChatRoomId: room.id },
      data: { active: false, socketId: null },
    });
    return direct;
  });
  if (!directRoom) return { ok: true, unlocked: true };

  io.to(`user:${userA.userId}`).emit('random:friend_accepted', {
    roomId, chatRoomId: directRoom.id, username: userB.username, userId: userB.userId,
  });
  io.to(`user:${userB.userId}`).emit('random:friend_accepted', {
    roomId, chatRoomId: directRoom.id, username: userA.username, userId: userA.userId,
  });
  for (const [id, active] of queues.activeRoomBySocket) {
    if (Number(active.roomId) === Number(roomId)) {
      queues.activeRoomBySocket.delete(id);
      io.sockets.sockets.get(id)?.leave(`random:${roomId}`);
    }
  }
  queues.sessionByRoomId.delete(roomId);

  return {
    ok: true,
    unlocked: true,
    chatRoomId: directRoom.id,
  };
}

/**
 * Ends an active random chat for a socket, typically on skip.
 * Notifies the peer that the session ended.
 */
export async function skipRandomChat({
  queues,
  io,
  prisma,
  socketId,
  userId,
  peerEndedReason = "peer_skipped",
}) {
  const room = await activeRandomRoomForSocket(prisma, userId, socketId);
  if (!room) return { ok: false, reason: 'not_in_active_random_room' };
  const ended = await endRandomRoom({
    prisma, io, room, reason: peerEndedReason, endedById: Number(userId),
  });
  if (!ended) return { ok: false, reason: 'already_ended' };
  for (const [id, active] of queues.activeRoomBySocket) {
    if (Number(active.roomId) === Number(room.chatRoomId)) {
      queues.activeRoomBySocket.delete(id);
      io.sockets.sockets.get(id)?.leave(`random:${room.chatRoomId}`);
    }
  }
  queues.sessionByRoomId.delete(room.chatRoomId);
  return { ok: true, roomId: room.chatRoomId };
}

/**
 * Handles disconnect cleanup:
 * - remove from waiting queue if present
 * - if in active room, notify peer and clean room session maps
 */
export function handleDisconnect({ queues, socketId }) {
  const waitingEntry = removeFromQueue(queues, socketId);
  queues.activeRoomBySocket.delete(socketId);
  return { removedFromQueue: Boolean(waitingEntry) };
}

async function createOrOpenDirectChatRoom(prisma, userId1, userId2) {
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
      randomChatRoom: {
        is: null,
      },
      AND: [
        { participants: { some: { userId: userId1 } } },
        { participants: { some: { userId: userId2 } } },
      ],
    },
    include: participantInclude,
  });

  if (existingRoom) return existingRoom;

  return prisma.chatRoom.create({
    data: {
      isGroup: false,
      participants: {
        create: [
          { user: { connect: { id: userId1 } }, role: "ADMIN" },
          { user: { connect: { id: userId2 } }, role: "MEMBER" },
        ],
      },
    },
    include: participantInclude,
  });
}
