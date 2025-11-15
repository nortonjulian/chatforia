import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

/**
 * One sweep: find expired statuses, delete related rows in a transaction,
 * and emit events to authors.
 *
 * Exported for unit tests; in production, registerStatusExpiryJob calls this on an interval.
 */
export async function sweepExpiredStatuses(io, prismaInstance = prisma) {
  const now = new Date();
  const expired = await prismaInstance.status.findMany({
    where: { expiresAt: { lte: now } },
    select: { id: true, authorId: true },
  });

  if (!expired.length) return;

  const ids = expired.map((s) => s.id);

  await prismaInstance.$transaction([
    prismaInstance.statusReaction.deleteMany({
      where: { statusId: { in: ids } },
    }),
    prismaInstance.statusView.deleteMany({
      where: { statusId: { in: ids } },
    }),
    prismaInstance.statusAsset.deleteMany({
      where: { statusId: { in: ids } },
    }),
    prismaInstance.statusKey.deleteMany({
      where: { statusId: { in: ids } },
    }),
    prismaInstance.status.deleteMany({
      where: { id: { in: ids } },
    }),
  ]);

  // notify author devices (optional)
  for (const s of expired) {
    io?.to(`user:${s.authorId}`).emit('status_expired', { statusId: s.id });
  }
}

/**
 * Register interval job that periodically sweeps expired statuses.
 */
export function registerStatusExpiryJob(io, { everyMs = 60_000 } = {}) {
  setInterval(() => {
    void sweepExpiredStatuses(io, prisma).catch(() => {});
  }, everyMs);
}

export default registerStatusExpiryJob;
