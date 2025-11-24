import 'dotenv/config';
import prisma from '../utils/prismaClient.js';

/**
 * Soft-delete old voicemails based on each user's
 * voicemailAutoDeleteDays setting.
 *
 * Usage (from project root or /server, depending on your scripts):
 *   node server/scripts/cleanupVoicemail.js
 *
 * You should hook this up to a daily cron / scheduler.
 */
async function cleanupVoicemail() {
  const now = new Date();

  // Find all users that have auto-delete configured
  const users = await prisma.user.findMany({
    where: {
      voicemailAutoDeleteDays: {
        not: null,
      },
    },
    select: {
      id: true,
      voicemailAutoDeleteDays: true,
    },
  });

  let totalSoftDeleted = 0;

  for (const user of users) {
    const days = user.voicemailAutoDeleteDays;
    if (!days || days <= 0) continue;

    const cutoff = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);

    const result = await prisma.voicemail.updateMany({
      where: {
        userId: user.id,
        deleted: false,
        createdAt: {
          lt: cutoff,
        },
      },
      data: {
        deleted: true,
        // If you later add a deletedAt field, you can also set:
        // deletedAt: now,
      },
    });

    if (result.count > 0) {
      console.log(
        `User ${user.id}: soft-deleted ${result.count} voicemail(s) older than ${days} days`,
      );
      totalSoftDeleted += result.count;
    }
  }

  console.log(`Voicemail cleanup complete. Total soft-deleted: ${totalSoftDeleted}`);
}

cleanupVoicemail()
  .catch((err) => {
    console.error('Voicemail cleanup failed:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
