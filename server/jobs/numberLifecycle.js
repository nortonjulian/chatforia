import prisma from '../utils/prismaClient.js';
import cron from 'node-cron';

const inactivityDays = Number(process.env.NUMBER_INACTIVITY_DAYS) || 30;
const holdDays = Number(process.env.NUMBER_HOLD_DAYS) || 14;

export function startNumberLifecycleJob() {
  // Run daily at 02:15
  cron.schedule('15 2 * * *', async () => {
    const nowMs = Date.now();
    const now = new Date(nowMs);
    const cutoff = new Date(nowMs - inactivityDays * 24 * 60 * 60 * 1000);

    // 1) Move ASSIGNED but inactive to HOLD (unless keepLocked)
    const inactive = await prisma.phoneNumber.findMany({
      where: {
        status: 'ASSIGNED',
        keepLocked: false,
        OR: [
          { lastOutboundAt: null },
          { lastOutboundAt: { lt: cutoff } },
        ],
      },
    });

    for (const n of inactive || []) {
      const holdUntil = new Date(
        nowMs + holdDays * 24 * 60 * 60 * 1000
      );
      await prisma.phoneNumber.update({
        where: { id: n.id },
        data: { status: 'HOLD', holdUntil, releaseAfter: holdUntil },
      });
      // TODO: notify user Day 30 warning -> email/push/in-app banner
    }

    // 2) Release HOLD past holdUntil
    const toRelease = await prisma.phoneNumber.findMany({
      where: { status: 'HOLD', releaseAfter: { lt: now } },
    });

    for (const n of toRelease || []) {
      // provider release best-effort
      await prisma.phoneNumber.update({
        where: { id: n.id },
        data: {
          status: 'RELEASING',
          assignedUserId: null,
          assignedAt: null,
          keepLocked: false,
          holdUntil: null,
          releaseAfter: null,
        },
      });
    }

    // 3) Cleanup expired reservations
    await prisma.numberReservation.deleteMany({
      where: { expiresAt: { lt: now } },
    });
  });
}
