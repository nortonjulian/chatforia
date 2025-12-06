import cron from 'node-cron';
import prisma from '../utils/prismaClient.js';

const FREE_RETENTION_DAYS = Number(process.env.MESSAGE_RETENTION_FREE_DAYS) || 30;
const PAID_RETENTION_DAYS = Number(process.env.MESSAGE_RETENTION_PAID_DAYS) || 180;

export function startMessageRetentionJob() {
  // Run daily at 03:10 UTC
  cron.schedule('10 3 * * *', async () => {
    const nowMs = Date.now();
    const now = new Date(nowMs);
    const freeCutoff = new Date(nowMs - FREE_RETENTION_DAYS * 24 * 60 * 60 * 1000);
    const paidCutoff = new Date(nowMs - PAID_RETENTION_DAYS * 24 * 60 * 60 * 1000);

    console.log(
      `[MessageRetention] Starting at ${now.toISOString()} (freeCutoff=${freeCutoff.toISOString()}, paidCutoff=${paidCutoff.toISOString()})`,
    );

    try {
      // FREE users: 30 days
      const freeResult = await prisma.message.deleteMany({
        where: {
          createdAt: { lt: freeCutoff },
          sender: { plan: 'FREE' }, // adjust relation/plan names if needed
        },
      });
      console.log(
        `[MessageRetention] Deleted ${freeResult.count} messages for FREE users (older than ${FREE_RETENTION_DAYS} days)`,
      );

      // PLUS + PREMIUM users: 180 days
      const paidResult = await prisma.message.deleteMany({
        where: {
          createdAt: { lt: paidCutoff },
          sender: { plan: { in: ['PLUS', 'PREMIUM'] } },
        },
      });
      console.log(
        `[MessageRetention] Deleted ${paidResult.count} messages for PLUS/PREMIUM users (older than ${PAID_RETENTION_DAYS} days)`,
      );
    } catch (err) {
      console.error('[MessageRetention] Error while pruning messages:', err);
    }

    console.log('[MessageRetention] Job complete\n');
  });
}
