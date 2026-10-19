import cron from 'node-cron';
import prisma from '../utils/prismaClient.js';

const tasks = [];

/**
 * Start background cleanup jobs.
 * Runs at minute 5 of every hour.
 */
export function startCleanupJobs() {
  const hourly = cron.schedule('5 * * * *', async () => {
    const now = new Date();

    try {
      // --- ProvisionLinks: remove expired or already-used ---
      try {
        const res = await prisma.provisionLink?.deleteMany?.({
          where: {
            OR: [
              { expiresAt: { lt: now } },
              { usedAt: { not: null } },
            ],
          },
        });
        if (res?.count) {
          console.log(`🧹 Deleted ${res.count} expired/used ProvisionLinks`);
        }
      } catch (e) {
        console.warn('[CLEANUP] provisionLink:', e?.message || e);
      }

      // --- Password reset tokens: expire by time ---
      try {
        const res = await prisma.passwordResetToken?.deleteMany?.({
          where: { expiresAt: { lt: now } },
        });
        if (res?.count) {
          console.log(`🧹 Deleted ${res.count} expired PasswordResetTokens`);
        }
      } catch (e) {
        console.warn('[CLEANUP] passwordResetToken:', e?.message || e);
      }

      // --- Messages: disappearing / expiresAt ---
      try {
        const res = await prisma.message?.deleteMany?.({
          where: { expiresAt: { lt: now }, deletedForAll: true },
        });
        if (res?.count) {
          console.log(`🧹 Deleted ${res.count} expired Messages`);
        }
      } catch (e) {
        console.warn('[CLEANUP] message:', e?.message || e);
      }

      // --- Statuses: expire by time (if your schema uses expiresAt) ---
      try {
        const res = await prisma.status?.deleteMany?.({
          where: { expiresAt: { lt: now } },
        });
        if (res?.count) {
          console.log(`🧹 Deleted ${res.count} expired Statuses`);
        }
      } catch (e) {
        console.warn('[CLEANUP] status:', e?.message || e);
      }
    } catch (err) {
      console.error('[CLEANUP] hourly job error:', err?.message || err);
    }
  });

  tasks.push(hourly);
}

/**
 * Stop all scheduled cleanup jobs (useful for graceful shutdown).
 */
export function stopCleanupJobs() {
  for (const t of tasks) {
    try {
      t.stop();
    } catch {}
  }
}
