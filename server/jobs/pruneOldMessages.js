import { prisma } from '../db.js';
import { MESSAGE_RETENTION_DAYS } from '../config/retention.js';

export async function pruneOldMessages() {
  const now = new Date();
  // For each plan with a limit
  for (const [plan, days] of Object.entries(MESSAGE_RETENTION_DAYS)) {
    if (!days) continue; // Premium/unlimited

    const cutoff = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);

    await prisma.message.deleteMany({
      where: {
        createdAt: { lt: cutoff },
        user: { plan }, // or conversation participants’ plan, depending on your schema
      },
    });
  }
}
