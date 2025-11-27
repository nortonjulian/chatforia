import prisma from '../utils/prismaClient.js';
import cron from 'node-cron';
import twilioClient from '../utils/twilioClient.js';

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
        data: {
          status: 'HOLD',
          holdUntil,
          releaseAfter: holdUntil,
        },
      });
      // TODO: notify user Day 30 warning -> email/push/in-app banner
    }

    // 2) Release HOLD past holdUntil
    const toRelease = await prisma.phoneNumber.findMany({
      where: {
        status: 'HOLD',
        releaseAfter: { lt: now },
        provider: 'twilio',        // 🔐 safety: only touch Twilio-owned pool
      },
    });

    for (const n of toRelease || []) {
      // If Twilio isn't configured, don't nuke your DB state silently
      if (!twilioClient) {
        console.warn(
          '[numberLifecycle] Twilio not configured; skipping release for phoneNumber id=',
          n.id
        );
        continue;
      }

      try {
        // Best-effort provider release
        if (n.twilioSid) {
          await twilioClient
            .incomingPhoneNumbers(n.twilioSid)
            .remove();
        } else {
          console.warn(
            '[numberLifecycle] phoneNumber missing twilioSid; cannot release upstream. id=',
            n.id
          );
        }

        await prisma.phoneNumber.update({
          where: { id: n.id },
          data: {
            status: 'RELEASED',     // or AVAILABLE if you keep rows for history
            assignedUserId: null,
            assignedAt: null,
            keepLocked: false,
            holdUntil: null,
            releaseAfter: null,
          },
        });
      } catch (err) {
        console.error(
          '[numberLifecycle] Failed to release Twilio number',
          { id: n.id, e164: n.e164, twilioSid: n.twilioSid },
          err
        );
        // You might choose to keep status=HOLD here so it retries tomorrow
      }
    }

    // 3) Cleanup expired reservations
    await prisma.numberReservation.deleteMany({
      where: { expiresAt: { lt: now } },
    });
  });
}
