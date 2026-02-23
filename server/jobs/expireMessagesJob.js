import prisma from '../utils/prismaClient.js';
import * as socketBus from '../services/socketBus.js';

/**
 * Find messages whose expiresAt <= now and tombstone them, then
 * emit authoritative expired upserts so clients receive canonical rows.
 *
 * limit — how many messages to process in one pass (default: 200)
 */
export async function expireMessagesOnce({ limit = 200 } = {}) {
  const now = new Date();
  try {
    // Find messages that have expired and are not already tombstoned
    const toExpire = await prisma.message.findMany({
      where: { expiresAt: { lte: now }, deletedForAll: false },
      take: limit,
      select: { id: true, chatRoomId: true, expiresAt: true },
    });
    if (!toExpire.length) return { expired: 0 };

    const ids = toExpire.map((m) => m.id);
    const chatRoomMap = new Map(toExpire.map((m) => [m.id, m.chatRoomId]));

    // Mark tombstone & clear sensitive fields (you may choose to physically delete files separately)
    const deletedAt = new Date();
    await prisma.message.updateMany({
      where: { id: { in: ids } },
      data: {
        deletedForAll: true,
        deletedAt,
        rawContent: null,
        contentCiphertext: null,
        translations: null,
        translatedContent: null,
      },
    });

    // Emit per-message expired upsert so clients receive authoritative rows (socketBus helper will upsert).
    for (const id of ids) {
      const roomId = chatRoomMap.get(id);
      // emitMessageExpired will try fetchMessageById and send upsert + legacy expired event
      await socketBus.emitMessageExpired(roomId, id, now.toISOString());
    }

    return { expired: ids.length };
  } catch (err) {
    console.error('[expireMessagesOnce] failed:', err?.message || err);
    return { expired: 0, error: err };
  }
}

/**
 * Example scheduler: call expireMessagesOnce every 30s (do not enable multiple workers at once)
 * If you run multiple processes, use DB locks or a leader election to avoid duplicate workers.
 */
export function startExpiryPoller({ intervalMs = 30_000 } = {}) {
  // If you already have a job runner (bull/agenda), prefer scheduling there instead.
  const id = setInterval(() => {
    expireMessagesOnce().catch((e) => {
      console.error('[expiryPoller] error', e?.message || e);
    });
  }, intervalMs);

  // allow process to exit if nothing else is keeping it alive
  id.unref?.();

  return () => clearInterval(id); // stopper
}