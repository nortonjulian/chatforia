import cron from 'node-cron';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export function startTranscriptRetentionJob() {
  // run daily at 03:10
  cron.schedule('10 3 * * *', async () => {
    const users = await prisma.user.findMany({
      select: {
        id: true,
        a11yStoreTranscripts: true,
        a11yTranscriptRetentionDays: true,
      },
    });

    const now = Date.now();

    for (const u of users) {
      if (!u.a11yStoreTranscripts) {
        // user opted out of transcripts entirely → delete all
        await prisma.transcript.deleteMany({ where: { userId: u.id } });
        continue;
      }

      if (u.a11yTranscriptRetentionDays && u.a11yTranscriptRetentionDays > 0) {
        const cutoff = new Date(
          now - u.a11yTranscriptRetentionDays * 24 * 60 * 60 * 1000
        );

        await prisma.transcript.deleteMany({
          where: {
            userId: u.id,
            createdAt: { lt: cutoff },
          },
        });
      }
    }
  });
}
