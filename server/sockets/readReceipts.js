export function registerReadReceipts(io, socket, { prisma, IS_TEST = false }) {
  socket.on('message:read', async (payload, ack) => {
    try {
      const { roomId, messageId } = payload || {};
      const userId = socket.user?.id;

      if (!userId) return ack?.({ ok: false, error: 'UNAUTHORIZED' });

      const chatRoomId = Number(roomId);
      const mid = Number(messageId);

      // payload validation
      if (!Number.isFinite(chatRoomId) || !Number.isFinite(mid)) {
        return ack?.({ ok: false, error: 'BAD_PAYLOAD' });
      }

      // Guard: only server-issued ids
      if (mid <= 0) return ack?.({ ok: true, ignored: true });

      // ✅ Membership check (Participant)
      const member = await prisma.participant.findUnique({
        where: {
          chatRoomId_userId: { chatRoomId, userId: Number(userId) },
        },
        select: { userId: true },
      });
      if (!member) return ack?.({ ok: false, error: 'FORBIDDEN' });

      // ✅ Ensure message belongs to this room
      const msg = await prisma.message.findUnique({
        where: { id: mid },
        select: { id: true, chatRoomId: true },
      });
      if (!msg || msg.chatRoomId !== chatRoomId) {
        return ack?.({ ok: false, error: 'MESSAGE_NOT_IN_ROOM' });
      }

      // First-read-wins idempotency
      const existing = await prisma.messageRead.findUnique({
        where: {
          messageId_userId: { messageId: mid, userId: Number(userId) },
        },
        select: { readAt: true },
      });

      if (existing) {
        return ack?.({
          ok: true,
          created: false,
          readAt: existing.readAt.toISOString(),
        });
      }

      const created = await prisma.messageRead.create({
        data: { messageId: mid, userId: Number(userId) },
        select: { readAt: true },
      });

      const evt = {
        roomId: chatRoomId,
        messageId: mid,
        userId: Number(userId),
        readAt: created.readAt.toISOString(),
      };

      // Broadcast only on first insert (less churn)
      io.to(String(chatRoomId)).emit('message:read', evt);

      return ack?.({ ok: true, created: true, readAt: evt.readAt });
    } catch (e) {
      if (!IS_TEST) console.error('[WS] message:read error', e?.message || e);
      return ack?.({ ok: false, error: 'SERVER_ERROR' });
    }
  });
}