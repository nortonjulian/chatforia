/**
 * Optional in-app copy notice. This is not a general clipboard monitor:
 * cooperating clients report successful "Copy" menu actions only.
 *
 * Do not forward copied content, recipient-supplied user IDs, or any URLs.
 */
export function registerCopyNotices(io, socket, { prisma, now = () => Date.now() }) {
  const actorId = Number(socket.user?.id);
  if (!Number.isSafeInteger(actorId) || actorId <= 0) return;

  // Per-connection throttle: prevents accidental repeat taps and burst spam.
  const recent = new Map();
  const cooldownMs = 30_000;
  const maxEntries = 200;

  socket.on('message:copied', async (payload) => {
    const messageId = payload?.messageId;
    if (!Number.isSafeInteger(messageId) || messageId <= 0) return;

    const at = now();
    const previous = recent.get(messageId);
    if (previous !== undefined && at - previous < cooldownMs) return;
    recent.set(messageId, at);
    if (recent.size > maxEntries) recent.delete(recent.keys().next().value);

    try {
      const msg = await prisma.message.findUnique({
        where: { id: messageId },
        select: {
          id: true,
          chatRoomId: true,
          senderId: true,
          deletedForAll: true,
          deletedBySender: true,
          expiresAt: true,
          isHiddenByModeration: true,
        },
      });
      if (!msg || msg.senderId === actorId || msg.deletedForAll ||
          msg.deletedBySender || msg.isHiddenByModeration ||
          (msg.expiresAt && new Date(msg.expiresAt).getTime() <= at)) return;

      // A caller must be a participant in the actual message's room.
      // Never accept room or sender information from the client.
      const membership = await prisma.participant.findFirst({
        where: { chatRoomId: msg.chatRoomId, userId: actorId },
        select: { id: true },
      });
      if (!membership) return;

      const sender = await prisma.user.findUnique({
        where: { id: msg.senderId },
        select: { notifyOnCopy: true },
      });
      if (sender?.notifyOnCopy !== true) return;

      io.to(`user:${msg.senderId}`).emit('message:copy-notice', {
        messageId: msg.id,
        chatRoomId: msg.chatRoomId,
        copiedByUserId: actorId,
        at: new Date(at).toISOString(),
      });
    } catch (error) {
      // Fail closed: copy stays local; never emit on authorization errors.
      if (process.env.NODE_ENV !== 'test') {
        console.warn('[copy-notice] skipped:', error?.message || error);
      }
    }
  });
}
