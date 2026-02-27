import express from 'express';
import prisma from '../utils/prismaClient.js';
import { v4 as uuidv4 } from 'uuid';
import { createEsimProfileForProvider, handleProviderWebhook } from '../services/provisioningService.js';

const router = express.Router();

/* -------------------- existing helpers & routes (unchanged) ------------------ */

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

/* -------------------- GET /status (unchanged) ------------------ */
/* (paste your existing /status route here) */
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

    // ALSO optionally attach any linked Subscriber for the user (if present)
    const subscriber = await prisma.subscriber.findFirst({
      where: { userId: Number(req.user.id) },
    });

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
      subscriber: subscriber ? {
        id: subscriber.id,
        provider: subscriber.provider,
        status: subscriber.status,
        esimIccid: subscriber.esimIccid,
        msisdn: subscriber.msisdn
      } : null
    });
  } catch (err) {
    console.error('wireless status error:', err);
    return res.status(500).json({ error: 'Failed to load wireless status' });
  }
});

/* -------------------- debug consume (unchanged) ------------------ */

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

/* -------------------- NEW endpoints (wireless-first support) ------------------ */

/**
 * POST /wireless/checkout
 * Creates MobileDataPackPurchase + a pending Subscriber (wireless-first)
 * Body: { email?, planKey, kind? }
 */
router.post('/checkout', async (req, res) => {
  try {
    const { email, planKey, kind = 'ESIM', addonKind } = req.body;
    // Basic plan sizing logic (adapt to your Price table)
    const totalDataMb = planKey === '3GB' ? 3 * 1024 : planKey === '5GB' ? 5 * 1024 : 10 * 1024;

    const purchase = await prisma.mobileDataPackPurchase.create({
      data: {
        userId: req.user?.id ?? null,
        kind,
        addonKind: addonKind ?? planKey,
        purchasedAt: new Date(),
        totalDataMb,
        remainingDataMb: totalDataMb,
      },
    });

    const activationToken = uuidv4();
    const subscriber = await prisma.subscriber.create({
      data: {
        purchaseId: purchase.id,
        userId: req.user?.id ?? null,
        provider: 'telna', // default provider; you can select based on region
        status: 'PENDING',
        providerMeta: { activationToken },
      },
    });

    // return subscriber id and token so frontend can show QR/email instructions
    return res.json({ ok: true, subscriberId: subscriber.id, activationToken });
  } catch (err) {
    console.error('wireless/checkout error', err);
    return res.status(500).json({ error: 'checkout failed' });
  }
});

/**
 * POST /wireless/activate
 * Body: { subscriberId, activationToken? }
 * Kicks off provisioning with the selected provider adapter.
 */
router.post('/activate', async (req, res) => {
  try {
    const { subscriberId, activationToken } = req.body;
    let subscriber = null;
    if (subscriberId) {
      subscriber = await prisma.subscriber.findUnique({ where: { id: Number(subscriberId) } });
    } else if (activationToken) {
      // look up by providerMeta.activationToken
      subscriber = await prisma.subscriber.findFirst({
        where: { providerMeta: { path: ['activationToken'], equals: activationToken } },
      });
    }

    if (!subscriber) return res.status(404).json({ error: 'subscriber not found' });

    // Call provider adapter (normalize response)
    const prov = await createEsimProfileForProvider(subscriber.provider, {
      subscriberId: subscriber.id,
      purchaseId: subscriber.purchaseId,
    });

    await prisma.subscriber.update({
      where: { id: subscriber.id },
      data: {
        esimProfileId: prov.profileId ?? null,
        esimIccid: prov.iccid ?? null,
        externalSubscriberId: prov.externalId ?? null,
        providerMeta: { ...subscriber.providerMeta, lastProv: prov },
        status: prov.success ? 'PROVISIONING' : 'PENDING',
      },
    });

    // Update purchase record for backwards compat
    if (subscriber.purchaseId) {
      await prisma.mobileDataPackPurchase.update({
        where: { id: subscriber.purchaseId },
        data: {
          esimProfileId: prov.profileId ?? null,
          esimIccid: prov.iccid ?? null,
          qrCodeSvg: prov.qrSvg ?? null,
        },
      });
    }

    return res.json({ ok: true, provisioning: prov });
  } catch (err) {
    console.error('wireless/activate error:', err);
    return res.status(500).json({ error: 'activation failed' });
  }
});

/**
 * POST /wireless/claim
 * Attaches a subscriber to the currently authenticated user (wireless-first -> app)
 * Body: { subscriberId }
 */
router.post('/claim', async (req, res) => {
  try {
    if (!req.user?.id) return res.status(401).json({ error: 'Unauthorized' });
    const { subscriberId } = req.body;
    if (!subscriberId) return res.status(400).json({ error: 'subscriberId required' });

    const sub = await prisma.subscriber.findUnique({ where: { id: Number(subscriberId) } });
    if (!sub) return res.status(404).json({ error: 'subscriber not found' });

    await prisma.subscriber.update({
      where: { id: sub.id },
      data: { userId: Number(req.user.id) },
    });

    // optionally mirror esimIccid to User.esimIccid for convenience
    if (sub.esimIccid) {
      await prisma.user.update({
        where: { id: Number(req.user.id) },
        data: { esimIccid: sub.esimIccid },
      });
    }

    return res.json({ ok: true });
  } catch (err) {
    console.error('wireless/claim error:', err);
    return res.status(500).json({ error: 'claim failed' });
  }
});

/**
 * POST /wireless/webhooks/:provider
 * Generic receiver for provider webhooks (Telna / 1GLOBAL / Plintron later)
 * Provider adapter normalizes and returns { externalSubscriberId, event, payload }
 */
router.post('/webhooks/:provider', express.raw({ type: '*/*' }), async (req, res) => {
  try {
    const { provider } = req.params;
    const parsed = await handleProviderWebhook(provider, req); // adapter normalizes

    if (!parsed?.externalSubscriberId) {
      console.warn('webhook missing externalSubscriberId', parsed);
      return res.status(200).send('ok');
    }

    const sub = await prisma.subscriber.findFirst({
      where: { externalSubscriberId: parsed.externalSubscriberId },
    });

    if (!sub) {
      console.warn('webhook: no subscriber match for', parsed.externalSubscriberId);
      return res.status(200).send('ok');
    }

    let newStatus;
    if (parsed.event === 'activation.succeeded') newStatus = 'ACTIVE';
    if (parsed.event === 'activation.failed') newStatus = 'PENDING';
    if (parsed.event === 'provisioning.started') newStatus = 'PROVISIONING';
    if (parsed.event === 'porting.started') newStatus = 'PORTING';
    if (parsed.event === 'suspended') newStatus = 'SUSPENDED';
    if (parsed.event === 'cancelled') newStatus = 'CANCELLED';

    await prisma.subscriber.update({
      where: { id: sub.id },
      data: {
        status: newStatus ?? sub.status,
        providerMeta: { ...sub.providerMeta, lastWebhook: parsed.payload },
        esimIccid: parsed.iccid ?? sub.esimIccid,
        msisdn: parsed.msisdn ?? sub.msisdn,
      },
    });

    // also update purchase record if linked
    if (sub.purchaseId) {
      await prisma.mobileDataPackPurchase.update({
        where: { id: sub.purchaseId },
        data: {
          esimIccid: parsed.iccid ?? undefined,
        },
      });
    }

    return res.status(200).send('ok');
  } catch (err) {
    console.error('provider webhook error', err);
    return res.status(500).send('error');
  }
});

export default router;