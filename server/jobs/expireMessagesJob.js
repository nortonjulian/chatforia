import prisma from '../utils/prismaClient.js';
import { emitMessageExpired } from '../services/socketBus.js';

const BATCH = Number(process.env.EXPIRE_JOB_BATCH || 500);

/**
 * Single pass: claim up to BATCH candidate messages and emit canonical expired events.
 *
 * Pattern:
 * 1) SELECT candidate ids (expiresAt <= now && deletedForAll = false) LIMIT BATCH
 * 2) UPDATE those ids atomically (where deletedForAll = false) -> set tombstone fields + deletedAt = t
 * 3) Re-fetch rows with deletedAt === t (these are the rows *this worker* actually claimed)
 * 4) Emit per-room canonical expired payloads
 *
 * This avoids N+1 updates, duplication across workers, and emits canonical rows for clients.
 */
export async function expireMessagesOnce() {
  const now = new Date();

  // 1) pick candidate ids (simple read)
  const candidates = await prisma.message.findMany({
    where: {
      expiresAt: { lte: now },
      deletedForAll: false,
    },
    orderBy: { id: 'asc' },
    take: BATCH,
    select: { id: true },
  });

  if (!candidates || candidates.length === 0) {
    return { expired: 0 };
  }

  const ids = candidates.map((c) => c.id);
  const t = new Date();

  // 2) claim them in bulk (only rows still not tombstoned)
  await prisma.message.updateMany({
    where: { id: { in: ids }, deletedForAll: false },
    data: {
      deletedForAll: true,
      deletedAt: t,
      deletedById: null,
      rawContent: null,
      contentCiphertext: null,
    },
  });

  // 3) fetch canonical rows that have deletedAt === t (i.e. rows this worker claimed)
  const expiredRows = await prisma.message.findMany({
    where: {
      id: { in: ids },
      deletedAt: t,
    },
    select: {
      id: true,
      chatRoomId: true,
      deletedForAll: true,
      deletedAt: true,
      deletedById: true,
      createdAt: true,
    },
  });

  // 4) Emit canonical expired rows per-room
  for (const row of expiredRows) {
    try {
      // emitMessageExpired should emit an authoritative/canonical upsert or tombstone
      // that your clients understand (we expect socketBus.emitMessageExpired to already
      // call emitMessageUpsert under the hood if you built it that way).
      await emitMessageExpired(row.chatRoomId, row);
    } catch (e) {
      // keep running even if one emit fails
      console.error('[expireJob] emit failed', e);
    }
  }

  return { expired: expiredRows.length };
}

/**
 * Scheduler: run immediately then every `intervalMs`.
 * Returns a stopper function that will clear the timer.
 */
export function scheduleExpireJob(intervalMs = Number(process.env.EXPIRE_JOB_INTERVAL_MS || 15_000)) {
  // run immediately (don't await to avoid blocking startup)
  expireMessagesOnce().catch((e) => console.error('[expireJob] initial run failed', e));

  const id = setInterval(() => {
    expireMessagesOnce().catch((e) => console.error('[expireJob] run failed', e));
  }, intervalMs);

  // allow process to exit if nothing else is keeping it alive
  id.unref?.();

  // return stopper
  return () => clearInterval(id);
}