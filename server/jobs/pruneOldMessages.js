import prisma from '../utils/prismaClient.js';
import { emitMessageExpired, emitMessageUpsert } from '../services/socketBus.js';

/**
 * Process messages whose expiresAt <= now.
 * - Batches so it scales
 * - Marks tombstone (deletedForAll=true, deletedAt=now, deletedById=null)
 * - Clears content fields so clients receive a tombstone object
 * - Emits message:expired for each tombstone (payload matches your shaped tombstone)
 */

const BATCH = 200;

export async function processExpiredMessages() {
  const now = new Date();

  // find candidates that haven't already been tombstoned
  const expired = await prisma.message.findMany({
    where: {
      expiresAt: { lte: now },
      deletedForAll: false,
    },
    take: BATCH,
    select: {
      id: true,
      chatRoomId: true,
      expiresAt: true,
      createdAt: true,
      senderId: true,
    },
  });

  if (!expired.length) return;

  const ids = expired.map((m) => m.id);
  const ts = new Date();

  // perform DB update in a transaction and fetch minimal shaped rows to emit
  const updated = await prisma.$transaction(async (tx) => {
    // mark as tombstoned and clear sensitive fields
    await tx.message.updateMany({
      where: { id: { in: ids } },
      data: {
        deletedForAll: true,
        deletedAt: ts,
        deletedById: null,
        rawContent: null,
        contentCiphertext: null,
        translations: null,
        translatedContent: null,
      },
    });

    // fetch shaped rows to emit to sockets (match shape your clients expect for tombstones)
    const rows = await tx.message.findMany({
      where: { id: { in: ids } },
      select: {
        id: true,
        chatRoomId: true,
        createdAt: true,
        expiresAt: true,
        deletedForAll: true,
        deletedAt: true,
        deletedById: true,
        sender: { select: { id: true, username: true, publicKey: true, avatarUrl: true } },
      },
    });

    return rows;
  });

  // Emit for each message (non-blocking)
  for (const m of updated) {
    const payload = {
      id: m.id,
      chatRoomId: m.chatRoomId,
      createdAt: m.createdAt?.toISOString?.() ?? null,
      expiresAt: m.expiresAt?.toISOString?.() ?? null,
      sender: m.sender ?? null,
      deletedForAll: true,
      deletedAt: m.deletedAt?.toISOString?.() ?? new Date().toISOString(),
      deletedById: m.deletedById ?? null,
      rawContent: null,
      contentCiphertext: null,
      attachments: [],
      translatedForMe: null,
    };

    try {
      // Preferred: broadcast canonical DB row so downstream consumers get stable shape
      // Pass the full shaped row `m` (or rehydrate with any additional fields if needed)
      await emitMessageUpsert(m.chatRoomId, m);

      // have socketBus send this. If your socketBus emitMessageExpired already
      // calls emitMessageUpsert internally, you can skip one of these.
      try {
        emitMessageExpired(m.chatRoomId, payload); // don't await unless you want strict ordering
      } catch (err) {
        console.warn('[processExpiredMessages] emitMessageExpired failed', err);
      }
    } catch (err) {
      console.error('[processExpiredMessages] emitMessageUpsert failed for', m.id, err);
      // decide whether to continue or rethrow — here we continue
    }
  }
}