import { prisma } from '../utils/prismaClient.js';

export function registerStatusExpiryJob(io, { everyMs = 60_000 } = {}) {
  async function sweep() {
    const now = new Date();
    const expired = await prisma.status.findMany({
      where: { expiresAt: { lte: now } },
      select: { id: true, authorId: true },
    });
    if (!expired.length) return;

    await prisma.$transaction([
      prisma.statusReaction.deleteMany({
        where: { statusId: { in: expired.map((s) => s.id) } },
      }),
      prisma.statusView.deleteMany({
        where: { statusId: { in: expired.map((s) => s.id) } },
      }),
      prisma.statusAsset.deleteMany({
        where: { statusId: { in: expired.map((s) => s.id) } },
      }),
      prisma.statusKey.deleteMany({
        where: { statusId: { in: expired.map((s) => s.id) } },
      }),
      prisma.status.deleteMany({
        where: { id: { in: expired.map((s) => s.id) } },
      }),
    ]);

    // notify author devices (optional)
    for (const s of expired)
      io?.to(`user:${s.authorId}`).emit('status_expired', { statusId: s.id });
  }

  setInterval(() => void sweep().catch(() => {}), everyMs);
}
