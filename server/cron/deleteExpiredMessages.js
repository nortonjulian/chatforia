import prisma from '../utils/prismaClient.js';
import { emitMessageExpiryNotice } from '../services/socketBus.js';

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
        select: { id: true, chatRoomId: true, expiresAt: true },
        take: 250,
      });

      if (!expired.length) return;

      await prisma.message.deleteMany({
        where: { id: { in: expired.map((m) => m.id) } },
      });

      // Resolve the live socket dynamically: startup invokes this job before
      // Socket.IO exists. A deleted row can no longer be fetched for an upsert.
      for (const m of expired) {
        emitMessageExpiryNotice(m.chatRoomId, m.id, m.expiresAt);
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