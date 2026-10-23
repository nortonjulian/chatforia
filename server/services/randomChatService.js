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
      myAlias: session.users[userA.userId].alias,
      partnerAlias: session.users[userB.userId].alias,
      partnerDisplayName: contactA
        ? (contactA.alias || userB.username || session.users[userB.userId].alias)
        : session.users[userB.userId].alias,
      relationshipStatus: contactA ? "friends" : "none",
    });
  }

  if (socketB) {
    socketB.join(chan);
    socketB.emit("random:matched", {
      roomId,
      myAlias: aliasForB,
      partnerAlias: aliasForA,
      partnerDisplayName: contactB
        ? (contactB.alias || userA.username || aliasForA)
        : aliasForA,
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
      peerIdx = i;
      break;
    }
  }

  if (peerIdx === -1) {
    enqueue(queues, currentEntry);
    const socket = getSocketById(currentEntry.socketId);
    if (socket) socket.emit("random:waiting", { message: "Looking for a partner…" });
    return { matched: false };
  }

  const peerEntry = queues.waitingQueue[peerIdx];

  // Remove peer from queue
  queues.waitingQueue.splice(peerIdx, 1);
  queues.waitingBySocket.delete(peerEntry.socketId);

  const room = await createRandomRoom(prisma, currentEntry, peerEntry);

  queues.activeRoomBySocket.set(currentEntry.socketId, {
    roomId: room.chatRoomId,
    randomChatRoomId: room.randomChatRoomId,
    peerSocketId: peerEntry.socketId,
    peerUserId: peerEntry.userId,
  });

  queues.activeRoomBySocket.set(peerEntry.socketId, {
    roomId: room.chatRoomId,
    randomChatRoomId: room.randomChatRoomId,
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
  await prisma.$transaction(async (tx) => {
    const existingA = await tx.contact.findUnique({
      where: {
        ownerId_userId: {
          ownerId: userA.userId,
          userId: userB.userId,
        },
      },
    });

    if (!existingA) {
      await tx.contact.create({
        data: {
          ownerId: userA.userId,
          userId: userB.userId,
          alias: userB.username || null,
        },
      });
    }

    const existingB = await tx.contact.findUnique({
      where: {
        ownerId_userId: {
          ownerId: userB.userId,
          userId: userA.userId,
        },
      },
    });

    if (!existingB) {
      await tx.contact.create({
        data: {
          ownerId: userB.userId,
          userId: userA.userId,
          alias: userA.username || null,
        },
      });
    }
  });
}

/**
 * Marks that a user in a random room requested "Add Friend".
 * When both sides request it, usernames become unlocked.
 */
export async function requestAddFriend({ queues, io, prisma, roomId, userId }) {
  const session = queues.sessionByRoomId.get(roomId);
  if (!session) {
    return { ok: false, reason: "session_not_found" };
  }

  const me = session.users[userId];
  if (!me) {
    return { ok: false, reason: "user_not_in_session" };
  }

  me.requestedFriend = true;

  const participants = Object.values(session.users);
  const bothRequested =
    participants.length === 2 &&
    participants.every((u) => u.requestedFriend);

  if (!bothRequested) {
    return { ok: true, unlocked: false };
  }

  session.isUnlocked = true;

  await prisma.randomChatRoom.updateMany({
    where: {
      chatRoomId: roomId,
      unlockedAt: null,
    },
    data: {
      unlockedAt: new Date(),
    },
  });

  const [userA, userB] = participants;

  const directRoom = await createOrOpenDirectChatRoom(
    prisma,
    userA.userId,
    userB.userId
  );

  await ensureMutualContacts(prisma, userA, userB);

  const socketA = io.sockets.sockets.get(userA.socketId);
  const socketB = io.sockets.sockets.get(userB.socketId);

  if (socketA) {
    socketA.emit("random:friend_accepted", {
      roomId,
      chatRoomId: directRoom.id,
      username: userB.username,
      userId: userB.userId,
    });
  }

  if (socketB) {
    socketB.emit("random:friend_accepted", {
      roomId,
      chatRoomId: directRoom.id,
      username: userA.username,
      userId: userA.userId,
    });
  }

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
  peerEndedReason = "peer_skipped",
}) {
  const active = queues.activeRoomBySocket.get(socketId);
  if (!active) {
    return { ok: false, reason: "not_in_active_random_room" };
  }

  const { roomId, peerSocketId } = active;

  queues.activeRoomBySocket.delete(socketId);

  const peerMeta = queues.activeRoomBySocket.get(peerSocketId);
  if (peerMeta && peerMeta.roomId === roomId) {
    queues.activeRoomBySocket.delete(peerSocketId);

    const peerSocket = io.sockets.sockets.get(peerSocketId);
    if (peerSocket) {
      peerSocket.leave(`random:${roomId}`);
      peerSocket.emit("random:ended", {
        roomId,
        reason: peerEndedReason,
      });
    }
  }

  const mySocket = io.sockets.sockets.get(socketId);
  if (mySocket) {
    mySocket.leave(`random:${roomId}`);
  }

  queues.sessionByRoomId.delete(roomId);

  try {
    await prisma.randomChatRoom.updateMany({
      where: {
        chatRoomId: roomId,
        endedAt: null,
      },
      data: {
        endedAt: new Date(),
      },
    });
  } catch (err) {
    console.error("[random] failed to mark random chat ended", {
      roomId,
      error: err?.message || err,
    });
  }

  return { ok: true, roomId };
}

/**
 * Handles disconnect cleanup:
 * - remove from waiting queue if present
 * - if in active room, notify peer and clean room session maps
 */
export function handleDisconnect({ queues, io, socketId }) {
  const waitingEntry = removeFromQueue(queues, socketId);
  if (waitingEntry) {
    return { removedFromQueue: true, endedRoom: false };
  }

  const active = queues.activeRoomBySocket.get(socketId);
  if (!active) {
    return { removedFromQueue: false, endedRoom: false };
  }

  const { roomId, peerSocketId } = active;
  queues.activeRoomBySocket.delete(socketId);

  const peerMeta = queues.activeRoomBySocket.get(peerSocketId);
  if (peerMeta && peerMeta.roomId === roomId) {
    queues.activeRoomBySocket.delete(peerSocketId);

    const peerSocket = io.sockets.sockets.get(peerSocketId);
    if (peerSocket) {
      peerSocket.leave(`random:${roomId}`);
      peerSocket.emit("random:ended", {
        roomId,
        reason: "peer_disconnected",
      });
    }
  }

  queues.sessionByRoomId.delete(roomId);

  return { removedFromQueue: false, endedRoom: true, roomId };
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