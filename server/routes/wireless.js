import express from 'express';
import prisma from '../utils/prismaClient.js';

const router = express.Router();

/**
 * Compute status flags for a pack or family pool.
 */
function computeStatus(totalMb, remainingMb, expiresAt) {
  const now = new Date();
  const total = totalMb || 0;
  const remaining = Math.max(0, remainingMb || 0);

  const expired = expiresAt ? new Date(expiresAt) <= now : false;
  if (expired) {
    return { state: 'EXPIRED', expired: true, low: false, exhausted: remaining <= 0 };
  }

  if (total <= 0) {
    // No configured limit, treat as NONE/UNLIMITED for now
    return { state: 'OK', expired: false, low: false, exhausted: false };
  }

  if (remaining <= 0) {
    return { state: 'EXHAUSTED', expired: false, low: false, exhausted: true };
  }

  const ratio = remaining / total;
  const low = ratio <= 0.1 || remaining <= 200; // low if <=10% or under 200 MB

  return {
    state: low ? 'LOW' : 'OK',
    expired: false,
    low,
    exhausted: false,
  };
}

/**
 * Helper: get the user's active individual eSIM pack (if any).
 * Picks the most recently created, non-expired pack with remaining data.
 */
async function getActiveIndividualPack(userId) {
  const now = new Date();
  return prisma.mobileDataPackPurchase.findFirst({
    where: {
      userId: Number(userId),
      expiresAt: { gt: now },
    },
    orderBy: { createdAt: 'desc' },
  });
}

/**
 * GET /api/wireless/status
 *
 * Returns current wireless status for:
 * - Family pool (if in a Family with data)
 * - Individual eSIM pack (if purchased)
 * - Or "NONE" if nothing active.
 */
router.get('/status', async (req, res) => {
  try {
    if (!req.user?.id) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const userId = Number(req.user.id);
    const now = new Date();

    // 1) Check if user is in a Family with data
    const membership = await prisma.familyMember.findFirst({
      where: { userId },
      include: { family: true },
    });

    if (membership?.family) {
      const family = membership.family;

      const totalDataMb = family.totalDataMb || 0;
      const usedDataMb = family.usedDataMb || 0;
      const remainingDataMb = Math.max(0, totalDataMb - usedDataMb);

      const status = computeStatus(totalDataMb, remainingDataMb, family.expiresAt || null);

      const daysRemaining = family.expiresAt
        ? Math.max(
            0,
            Math.ceil(
              (new Date(family.expiresAt).getTime() - now.getTime()) / (1000 * 60 * 60 * 24),
            ),
          )
        : null;

      return res.json({
        mode: 'FAMILY',
        state: status.state, // "OK" | "LOW" | "EXHAUSTED" | "EXPIRED"
        low: status.low,
        exhausted: status.exhausted,
        expired: status.expired,
        source: {
          type: 'FAMILY_POOL',
          familyId: family.id,
          name: family.name || 'My Chatforia Family',
          totalDataMb,
          usedDataMb,
          remainingDataMb,
          expiresAt: family.expiresAt,
          daysRemaining,
        },
      });
    }

    // 2) Otherwise, check individual eSIM pack
    const pack = await getActiveIndividualPack(userId);

    if (!pack) {
      // Check if there is an expired/zero pack to surface exhausted state
      const lastPack = await prisma.mobileDataPackPurchase.findFirst({
        where: { userId },
        orderBy: { createdAt: 'desc' },
      });

      if (!lastPack) {
        return res.json({ mode: 'NONE', state: 'NONE' });
      }

      const totalDataMb = lastPack.totalDataMb || 0;
      const remainingDataMb = lastPack.remainingDataMb || 0;
      const status = computeStatus(totalDataMb, remainingDataMb, lastPack.expiresAt || now);

      const daysRemaining = lastPack.expiresAt
        ? Math.max(
            0,
            Math.ceil(
              (new Date(lastPack.expiresAt).getTime() - now.getTime()) / (1000 * 60 * 60 * 24),
            ),
          )
        : 0;

      return res.json({
        mode: 'INDIVIDUAL',
        state: status.state,
        low: status.low,
        exhausted: status.exhausted,
        expired: status.expired,
        source: {
          type: 'ESIM_PACK',
          id: lastPack.id,
          addonKind: lastPack.addonKind,
          totalDataMb,
          remainingDataMb,
          expiresAt: lastPack.expiresAt,
          daysRemaining,
        },
      });
    }

    // We have an active, non-expired pack
    const totalDataMb = pack.totalDataMb || 0;
    const remainingDataMb = pack.remainingDataMb || 0;
    const status = computeStatus(totalDataMb, remainingDataMb, pack.expiresAt || null);

    const daysRemaining = pack.expiresAt
      ? Math.max(
          0,
          Math.ceil(
            (new Date(pack.expiresAt).getTime() - now.getTime()) / (1000 * 60 * 60 * 24),
          ),
        )
      : null;

    return res.json({
      mode: 'INDIVIDUAL',
      state: status.state,
      low: status.low,
      exhausted: status.exhausted,
      expired: status.expired,
      source: {
        type: 'ESIM_PACK',
        id: pack.id,
        addonKind: pack.addonKind,
        totalDataMb,
        remainingDataMb,
        expiresAt: pack.expiresAt,
        daysRemaining,
      },
    });
  } catch (err) {
    console.error('wireless status error:', err);
    return res.status(500).json({ error: 'Failed to load wireless status' });
  }
});

/**
 * Dev-only endpoint to simulate consumption.
 * POST /api/wireless/debug/consume { mb }
 */
router.post('/debug/consume', async (req, res) => {
  try {
    if (process.env.NODE_ENV === 'production') {
      return res.status(403).json({ error: 'Not available in production' });
    }
    if (!req.user?.id) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const mb = Number(req.body?.mb || 0);
    if (!Number.isFinite(mb) || mb <= 0) {
      return res.status(400).json({ error: 'mb must be > 0' });
    }

    const userId = Number(req.user.id);

    const pack = await getActiveIndividualPack(userId);
    if (!pack) {
      return res.status(400).json({ error: 'No active individual pack to consume from' });
    }

    const newRemaining = Math.max(0, (pack.remainingDataMb || 0) - mb);

    const updated = await prisma.mobileDataPackPurchase.update({
      where: { id: pack.id },
      data: { remainingDataMb: newRemaining },
    });

    return res.json({
      ok: true,
      id: updated.id,
      remainingDataMb: updated.remainingDataMb,
    });
  } catch (err) {
    console.error('wireless debug consume error:', err);
    return res.status(500).json({ error: 'Failed to consume data' });
  }
});

export default router;
