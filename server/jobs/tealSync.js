import prisma from '../utils/prismaClient.js';

/**
 * One-shot sync: pull usage from Teal for all active lines/packs
 * and update remainingDataMb (and any family pools).
 */
async function syncTealUsageOnce() {
  // Guard: only run if explicitly enabled
  if (process.env.ENABLE_TEAL_SYNC !== 'true') {
    return;
  }

  console.log('[tealSync] Starting usage sync…');

  // 1) Fetch all active individual eSIM packs
  // NOTE: adjust field names to match your schema (e.g. `tealLineId`).
  const now = new Date();
  const packs = await prisma.mobileDataPackPurchase.findMany({
    where: {
      expiresAt: { gt: now },
      // tealLineId: { not: null }, // <-- add this field later when you store Teal line IDs
    },
    // include: { user: true }, // if you need user info
  });

  // TODO: when you add Teal, store some identifier on each pack, e.g. `tealLineId`.
  // For now this is just a skeleton.
  for (const pack of packs) {
    try {
      // --- TEAL CALL PLACEHOLDER ---------------------------------------
      // When ready, uncomment and fill in with the real Teal API call.
      //
      // const res = await fetch(
      //   `${process.env.TEAL_API_BASE_URL}/lines/${pack.tealLineId}/usage`,
      //   {
      //     headers: {
      //       Authorization: `Bearer ${process.env.TEAL_API_KEY}`,
      //       'Content-Type': 'application/json',
      //     },
      //   }
      // );
      //
      // if (!res.ok) {
      //   console.error('[tealSync] Failed to fetch usage for pack', pack.id, res.status);
      //   continue;
      // }
      //
      // const usage = await res.json();
      // const usedMb = usage.usedMb; // adjust to Teal’s actual response shape
      //
      // const totalMb = pack.totalDataMb || 0;
      // const remainingMb = Math.max(0, totalMb - usedMb);

      // --- TEMP FAKE USAGE (for local experimentation only) ------------
      // You can delete this once Teal is wired in.
      const usedMb = (pack.totalDataMb || 0) - (pack.remainingDataMb || 0);
      const remainingMb = Math.max(0, (pack.totalDataMb || 0) - usedMb);

      await prisma.mobileDataPackPurchase.update({
        where: { id: pack.id },
        data: {
          remainingDataMb: remainingMb,
          // Optionally store last sync timestamp:
          // lastUsageSyncAt: new Date(),
        },
      });

      console.log(
        `[tealSync] Pack ${pack.id}: total=${pack.totalDataMb}MB, used≈${usedMb}MB, remaining=${remainingMb}MB`
      );
    } catch (err) {
      console.error('[tealSync] Error syncing pack', pack.id, err);
    }
  }

  // 2) OPTIONAL: recompute any Family pools from Teal usage if you decide
  //    to keep family totals in sync here as well.
  //
  // Example skeleton:
  //
  // const families = await prisma.family.findMany({
  //   where: { /* some condition for active families */ },
  // });
  //
  // for (const family of families) {
  //   try {
  //     // TODO: call Teal for each linked family line, sum up usage,
  //     // and update family.usedDataMb / remainingDataMb etc.
  //   } catch (err) {
  //     console.error('[tealSync] Error syncing family', family.id, err);
  //   }
  // }

  console.log('[tealSync] Usage sync complete.');
}

/**
 * Start a repeating timer.
 * You can wire this in app.js, and control activation via ENABLE_TEAL_SYNC.
 */
export function startTealUsageWorker() {
  // Don’t start the timer unless explicitly enabled
  if (process.env.ENABLE_TEAL_SYNC !== 'true') {
    console.log('[tealSync] Worker disabled (ENABLE_TEAL_SYNC != "true")');
    return;
  }

  const intervalMs = Number(process.env.TEAL_SYNC_INTERVAL_MS || 5 * 60 * 1000); // default 5 min

  console.log(
    `[tealSync] Worker enabled. Interval = ${intervalMs / 1000}s.`
  );

  // Run once on startup
  syncTealUsageOnce().catch((err) =>
    console.error('[tealSync] Initial sync error', err)
  );

  // And then periodically
  setInterval(() => {
    syncTealUsageOnce().catch((err) =>
      console.error('[tealSync] Periodic sync error', err)
    );
  }, intervalMs);
}
