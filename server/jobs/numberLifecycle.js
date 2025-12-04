import prisma from '../utils/prismaClient.js';
import cron from 'node-cron';
import twilioClient from '../utils/twilioClient.js';
import { notifyUserOfPendingRelease } from '../utils/notifications.js'; // 🔔 Your email/push/in-app logic

const inactivityDays = Number(process.env.NUMBER_INACTIVITY_DAYS) || 30;
const holdDays = Number(process.env.NUMBER_HOLD_DAYS) || 14;

export function startNumberLifecycleJob() {
  // Run daily at 02:15 UTC
  cron.schedule('15 2 * * *', async () => {
    const nowMs = Date.now();
    const now = new Date(nowMs);
    const inactivityCutoff = new Date(nowMs - inactivityDays * 24 * 60 * 60 * 1000);
    const holdUntilDate = new Date(nowMs + holdDays * 24 * 60 * 60 * 1000);

    console.log(`[NumberLifecycle] Job started at ${now.toISOString()}`);

    // 1) Move ASSIGNED but inactive to HOLD (unless keepLocked)
    const inactive = await prisma.phoneNumber.findMany({
      where: {
        status: 'ASSIGNED',
        keepLocked: false,
        OR: [
          { lastOutboundAt: null },
          { lastOutboundAt: { lt: inactivityCutoff } },
        ],
      },
    });

    for (const n of inactive) {
      await prisma.phoneNumber.update({
        where: { id: n.id },
        data: {
          status: 'HOLD',
          holdUntil: holdUntilDate,
          releaseAfter: holdUntilDate,
        },
      });

      console.log(`[NumberLifecycle] Moved to HOLD: ${n.e164} (User ID: ${n.assignedUserId})`);

      // 🔔 Optional: Notify user their number will be released in N days
      try {
        await notifyUserOfPendingRelease(n.assignedUserId, {
          number: n.e164,
          releaseDate: holdUntilDate,
        });
        console.log(`[Notify] Sent release warning to user ${n.assignedUserId}`);
      } catch (err) {
        console.warn(`[Notify] Failed to notify user ${n.assignedUserId}:`, err.message);
      }
    }

    // 2) Release HOLD numbers past holdUntil
    const toRelease = await prisma.phoneNumber.findMany({
      where: {
        status: 'HOLD',
        releaseAfter: { lt: now },
        provider: 'twilio',
      },
    });

    for (const n of toRelease) {
      if (!twilioClient) {
        console.warn(`[NumberLifecycle] Twilio not configured; skipping release for ${n.id}`);
        continue;
      }

      try {
        if (n.twilioSid) {
          await twilioClient.incomingPhoneNumbers(n.twilioSid).remove();
          console.log(`[NumberLifecycle] Released Twilio number: ${n.e164}`);
        } else {
          console.warn(`[NumberLifecycle] Missing twilioSid, cannot release: ${n.e164}`);
        }

        await prisma.phoneNumber.update({
          where: { id: n.id },
          data: {
            status: 'RELEASED',
            assignedUserId: null,
            assignedAt: null,
            keepLocked: false,
            holdUntil: null,
            releaseAfter: null,
          },
        });
      } catch (err) {
        console.error(`[NumberLifecycle] Failed to release ${n.e164} (SID: ${n.twilioSid}):`, err.message);
      }
    }

    // 3) Cleanup expired reservations
    const expired = await prisma.numberReservation.deleteMany({
      where: { expiresAt: { lt: now } },
    });

    console.log(`[NumberLifecycle] Cleaned up ${expired.count} expired reservations`);
    console.log(`[NumberLifecycle] Job complete\n`);
  });
}
