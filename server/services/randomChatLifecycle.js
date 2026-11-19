import Boom from '@hapi/boom';

export function randomResumeRequestId(payload) {
  return typeof payload?.requestId === 'string' &&
    /^[A-Za-z0-9_-]{1,80}$/.test(payload.requestId) ? payload.requestId : null;
}

export function randomChatGraceMs() {
  const configured = Number(process.env.RANDOM_CHAT_RECONNECT_GRACE_MS);
  return Number.isSafeInteger(configured) && configured >= 1000 && configured <= 600000
    ? configured : 120000;
}

export function connectionExpired(connection, now = new Date(), graceMs = randomChatGraceMs()) {
  if (!connection?.active) return true;
  const last = connection.disconnectedAt || connection.lastSeenAt;
  return !last || now.getTime() - new Date(last).getTime() >= graceMs;
}

export async function endRandomRoom({ prisma, io, room, reason, endedById = null, now = new Date() }) {
  const id = Number(room?.id);
  if (!Number.isSafeInteger(id)) return false;
  const ended = await prisma.$transaction(async (tx) => {
    const result = await tx.randomChatRoom.updateMany({
      where: { id, endedAt: null, unlockedAt: null },
      data: { endedAt: now, endedReason: reason, endedById },
    });
    if (result.count !== 1) return false;
    await tx.randomChatConnection.updateMany({
      where: { randomChatRoomId: id, active: true },
      data: { active: false, socketId: null },
    });
    return true;
  });
  if (ended && io) {
    for (const connection of room.connections || []) {
      io.to(`user:${connection.userId}`).emit('random:ended', {
        roomId: room.chatRoomId,
        reason: connection.userId === endedById
          ? (reason === 'peer_skipped' ? 'you_skipped' : 'you_left')
          : reason,
      });
    }
  }
  return ended;
}

export async function activeRandomRoomForUser(prisma, userId) {
  return prisma.randomChatRoom.findFirst({
    where: {
      endedAt: null,
      unlockedAt: null,
      connections: { some: { userId: Number(userId), active: true } },
    },
    include: {
      connections: true,
      participants: { select: { id: true, username: true } },
    },
    orderBy: { createdAt: 'desc' },
  });
}

export async function activeRandomRoomForSocket(prisma, userId, socketId) {
  const room = await activeRandomRoomForUser(prisma, userId);
  return room?.connections?.some((entry) =>
    entry.userId === Number(userId) && entry.socketId === socketId && entry.active
  ) ? room : null;
}

export async function expireRandomRoomIfNeeded({ prisma, io, room, now = new Date() }) {
  if (!room || room.endedAt || room.unlockedAt) return true;
  if (room.connections?.length !== 2 ||
      room.connections.some((entry) => connectionExpired(entry, now))) {
    await endRandomRoom({ prisma, io, room, reason: 'reconnect_timeout', now });
    return true;
  }
  return false;
}

export async function resumeRandomRoom({ prisma, io, socket, queues, userId, requestId = null }) {
  const room = await activeRandomRoomForUser(prisma, userId);
  if (!room) return null;
  if (await expireRandomRoomIfNeeded({ prisma, io, room })) return null;
  const me = room.connections.find((entry) => entry.userId === Number(userId));
  const peer = room.connections.find((entry) => entry.userId !== Number(userId));
  if (!me || !peer || !room.participants?.some((user) => user.id === Number(userId))) return null;

  const block = await prisma.userBlock.findFirst({
    where: { OR: [
      { blockerId: Number(userId), blockedId: peer.userId },
      { blockerId: peer.userId, blockedId: Number(userId) },
    ] },
    select: { id: true },
  });
  if (block) {
    await endRandomRoom({ prisma, io, room, reason: 'account_blocked' });
    return null;
  }

  await prisma.randomChatConnection.updateMany({
    where: { randomChatRoomId: room.id, userId: Number(userId), active: true },
    data: { socketId: socket.id, disconnectedAt: null, lastSeenAt: new Date() },
  });
  const binding = await prisma.randomChatConnection.findUnique({
    where: { randomChatRoomId_userId: { randomChatRoomId: room.id, userId: Number(userId) } },
  });
  if (binding?.socketId !== socket.id || !binding.active) return null;

  for (const [oldSocketId, active] of queues.activeRoomBySocket) {
    if (active.roomId === room.chatRoomId && active.userId === Number(userId) && oldSocketId !== socket.id) {
      queues.activeRoomBySocket.delete(oldSocketId);
      io.sockets.sockets.get(oldSocketId)?.leave(`random:${room.chatRoomId}`);
    }
  }
  queues.activeRoomBySocket.set(socket.id, {
    roomId: room.chatRoomId,
    randomChatRoomId: room.id,
    userId: Number(userId),
    peerUserId: peer.userId,
  });
  socket.join(`random:${room.chatRoomId}`);
  const aliases = room.aliasByUser && typeof room.aliasByUser === 'object' ? room.aliasByUser : {};
  const payload = {
    ...(requestId ? { requestId } : {}),
    roomId: room.chatRoomId,
    chatRoomId: room.chatRoomId,
    randomChatRoomId: room.id,
    myAlias: aliases[String(userId)] || 'You',
    partnerAlias: aliases[String(peer.userId)] || 'Someone',
    iRequestedFriend: Boolean(binding.friendRequestedAt),
    partnerReconnecting: Boolean(peer.disconnectedAt),
  };
  socket.emit('random:resumed', payload);
  io.to(`user:${peer.userId}`).emit('random:peer_resumed', { roomId: room.chatRoomId });
  return payload;
}

export async function disconnectRandomSocket({ prisma, io, queues, socketId, userId, now = new Date() }) {
  const room = await activeRandomRoomForSocket(prisma, userId, socketId);
  queues.activeRoomBySocket.delete(socketId);
  if (!room) return null;
  const result = await prisma.randomChatConnection.updateMany({
    where: { randomChatRoomId: room.id, userId: Number(userId), socketId, active: true },
    data: { socketId: null, disconnectedAt: now, lastSeenAt: now },
  });
  if (result.count === 1) {
    const peer = room.connections.find((entry) => entry.userId !== Number(userId));
    if (peer) io.to(`user:${peer.userId}`).emit('random:peer_reconnecting', {
      roomId: room.chatRoomId,
      graceMs: randomChatGraceMs(),
    });
  }
  return result.count === 1 ? room : null;
}

export async function touchRandomSocket(prisma, socketId, userId, now = new Date()) {
  await prisma.randomChatConnection.updateMany({
    where: { socketId, userId: Number(userId), active: true },
    data: { lastSeenAt: now },
  });
}

export async function sweepExpiredRandomRooms(prisma, io, now = new Date()) {
  const threshold = new Date(now.getTime() - randomChatGraceMs());
  const rows = await prisma.randomChatRoom.findMany({
    where: {
      endedAt: null,
      unlockedAt: null,
      connections: { some: { active: true, OR: [
        { disconnectedAt: { lte: threshold } },
        { lastSeenAt: { lte: threshold } },
      ] } },
    },
    include: { connections: true },
    take: 100,
  });
  for (const room of rows) await expireRandomRoomIfNeeded({ prisma, io, room, now });
}

export async function assertRandomRoomWritable(prisma, roomId, userId, encryptedPayloads, io = null) {
  const room = await prisma.randomChatRoom.findUnique({
    where: { chatRoomId: Number(roomId) },
    include: { connections: true },
  });
  if (!room) return;
  if (!room.connections.some((entry) => entry.userId === Number(userId)) ||
      await expireRandomRoomIfNeeded({ prisma, io, room }) ||
      !encryptedPayloads || typeof encryptedPayloads !== 'object' ||
      Array.isArray(encryptedPayloads) || room.connections.length !== 2 ||
      Object.keys(encryptedPayloads).length !== 2 ||
      room.connections.some((entry) => !Object.hasOwn(encryptedPayloads, String(entry.userId)))) {
    throw Boom.forbidden('Random Chat session is unavailable');
  }
  return room;
}
