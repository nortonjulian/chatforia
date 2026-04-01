import prisma from '../utils/prismaClient.js';

/**
 * Polls for expired messages and removes them. Emits a socket event so
 * online clients prune them immediately.
 *
 * @param {import('socket.io').Server} io
 * @param {number} [intervalMs=10000]
 */
export function initDeleteExpired(io, intervalMs = 10_000) {
  let isRunning = false;

  const timer = setInterval(async () => {
    if (isRunning) return;
    isRunning = true;

    try {
      const now = new Date();

      const expired = await prisma.message.findMany({
        where: { expiresAt: { lte: now } },
        select: { id: true, chatRoomId: true },
        take: 250,
      });

      if (!expired.length) return;

      await prisma.message.deleteMany({
        where: { id: { in: expired.map((m) => m.id) } },
      });

      if (io) {
        for (const m of expired) {
          io.to(String(m.chatRoomId)).emit('message_expired', { id: m.id });
        }
      }
    } catch (err) {
      console.error('[deleteExpiredMessages] failed:', err);
    } finally {
      isRunning = false;
    }
  }, intervalMs);

  const stop = async () => {
    clearInterval(timer);
  };

  return { stop };
}