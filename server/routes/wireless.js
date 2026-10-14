import express from 'express';
import prisma from '../utils/prismaClient.js';
import { v4 as uuidv4 } from 'uuid';
import { createEsimProfileForProvider, handleProviderWebhook } from '../services/provisioningService.js';
import { requireAuth } from '../middleware/auth.js';
import { fetchEsimUsage } from '../services/providers/esimProvider.js';
import { replaceEsimForDevice } from '../services/esimReplacementService.js';

const router = express.Router();

router.use(requireAuth);

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
 * Return usable individual eSIM pack candidates newest-first.
 *
 * Multiple Telna packages may share one ICCID after a top-up. In that
 * case the newest purchase is not necessarily the package currently
 * being consumed: Telna may report the new package as NOT_ACTIVE while
 * an older package remains ACTIVE.
 */
async function getIndividualPackCandidates(userId) {
  const now = new Date();

  return prisma.mobileDataPackPurchase.findMany({
    where: {
      userId: Number(userId),
      expiresAt: { gt: now },
      remainingDataMb: { gt: 0 },
    },
    orderBy: {
      purchasedAt: 'desc',
    },

    /*
     * Avoid polling an unbounded purchase history on every status
     * request. A small recent window is enough to resolve current and
     * queued top-ups while historical packs remain in the database.
     */
    take: 10,
  });
}

/**
 * Resolve the pack that should drive Current Usage.
 *
 * Provider ACTIVE is authoritative when available. If provider state
 * is unavailable (legacy purchase, mock provider, or transient provider
 * failure), preserve the historical newest-pack behavior as a safe
 * compatibility fallback.
 */
async function resolveActiveIndividualPack(userId) {
  const candidates =
    await getIndividualPackCandidates(userId);

  if (!candidates.length) {
    return {
      pack: null,
      providerStatus: null,
      queuedPacks: [],
    };
  }

  let fallback = null;
  let active = null;
  const queuedPacks = [];

  /*
   * Refresh/classify every recent usable candidate once. Do not stop
   * after finding ACTIVE because another candidate may be a queued
   * NOT_ACTIVE top-up that the client should surface separately.
   */
  for (const candidate of candidates) {
    const refreshed =
      await refreshPackUsageFromProvider(
        userId,
        candidate
      );

    if (!fallback) {
      fallback = refreshed;
    }

    if (
      refreshed?.providerStatus === 'ACTIVE' &&
      !active
    ) {
      active = refreshed;
      continue;
    }

    /*
     * Telna production uses NOT_ACTIVE for a purchased package waiting
     * behind the currently ACTIVE package. Do not treat arbitrary
     * non-ACTIVE provider states as customer-usable queued data.
     */
    if (
      refreshed?.providerStatus === 'NOT_ACTIVE' &&
      refreshed?.pack
    ) {
      queuedPacks.push(refreshed.pack);
    }
  }

  const selected =
    active ??
    fallback ?? {
      pack: null,
      providerStatus: null,
    };

  return {
    ...selected,

    /*
     * A compatibility fallback may itself be NOT_ACTIVE.
     * Only expose queued packages when the provider has
     * confirmed which package is currently ACTIVE. Otherwise
     * the fallback could appear as both Current Usage and a
     * queued pack, causing customer-facing data to be counted
     * twice.
     */
    queuedPacks: active ? queuedPacks : [],
  };
}

async function getLatestSubscriberForUser(userId) {
  return prisma.subscriber.findFirst({
    where: { userId: Number(userId) },
    orderBy: [
      { activatedAt: 'desc' },
      { createdAt: 'desc' },
    ],
  });
}

export function replacementEntitlementRemainingMb({
  entitlementMb,
  providerCapacityMb,
  providerRemainingMb,
}) {
  const entitlement = Number(entitlementMb);
  const capacity = Number(providerCapacityMb);
  const providerRemaining = Number(providerRemainingMb);

  if (
    !Number.isFinite(entitlement) ||
    entitlement < 0 ||
    !Number.isFinite(capacity) ||
    capacity <= 0 ||
    !Number.isFinite(providerRemaining) ||
    providerRemaining < 0
  ) {
    return null;
  }

  /*
   * A replacement package is only a provider-side container.
   * The customer keeps the entitlement that existed immediately
   * before replacement; unused capacity in the larger Telna template
   * must never become customer data.
   *
   * Round provider consumption UP because MobileDataPackPurchase
   * stores integer MB. This is conservative: fractional provider
   * consumption can never result in Chatforia granting extra data.
   */
  const boundedProviderRemaining =
    Math.min(providerRemaining, capacity);

  const providerConsumedMb =
    Math.ceil(
      Math.max(
        0,
        capacity - boundedProviderRemaining
      )
    );

  return Math.max(
    0,
    Math.min(
      Math.ceil(entitlement),
      Math.ceil(entitlement) -
        providerConsumedMb
    )
  );
}

async function refreshPackUsageFromProvider(userId, pack) {
  if (!pack) {
    return {
      pack,
      providerStatus: null,
    };
  }

  /*
   * Usage is associated with the provider's purchased data package,
   * not with the eSIM profile itself.
   *
   * For Telna Connect v2.1 this is the package ID returned when the
   * package is created and stored as providerPurchaseId.
   */
  const providerUsageId =
    pack.providerPurchaseId || null;

  /*
   * Older purchases may not have a providerPurchaseId because they
   * predate package-ID persistence. Do not incorrectly substitute the
   * profile ID or ICCID for Telna package usage.
   */
  if (!providerUsageId) {
    return {
      pack,
      providerStatus: null,
    };
  }

  // Sandbox/mock purchases do not have a real provider package to
  // query. Keep using the balance already stored in Chatforia.
  if (
    String(providerUsageId)
      .startsWith('mock-')
  ) {
    return {
      pack,
      providerStatus: null,
    };
  }

  try {
    const usage =
      await fetchEsimUsage(
        providerUsageId
      );

    const nextTotalMb =
      typeof usage.totalMb === 'number' &&
      usage.totalMb >= 0
        ? Math.round(usage.totalMb)
        : pack.totalDataMb;

    let nextRemainingMb =
      typeof usage.remainingMb === 'number' &&
      usage.remainingMb >= 0
        ? Math.round(usage.remainingMb)
        : pack.remainingDataMb;

    /*
     * A replacement may require a larger provider-side package
     * container than the customer's transferred entitlement.
     * Translate consumption against the replacement audit so unused
     * Telna template capacity never becomes customer data.
     */
    if (
      typeof usage.remainingMb === 'number' &&
      usage.remainingMb >= 0
    ) {
      const replacement =
        await prisma.esimReplacement.findFirst({
          where: {
            userId: Number(userId),
            newProviderPurchaseId:
              String(providerUsageId),
          },
          orderBy: {
            createdAt: 'desc',
          },
        });

      if (
        replacement &&
        typeof replacement.remainingDataMb === 'number' &&
        typeof replacement.replacementDataMb === 'number'
      ) {
        const translatedRemainingMb =
          replacementEntitlementRemainingMb({
            entitlementMb:
              replacement.remainingDataMb,
            providerCapacityMb:
              replacement.replacementDataMb,
            providerRemainingMb:
              usage.remainingMb,
          });

        if (translatedRemainingMb != null) {
          nextRemainingMb =
            translatedRemainingMb;
        }
      }
    }

    const nextExpiresAt =
      usage.expiresAt ??
      pack.expiresAt ??
      null;

    /*
     * Provider usage refresh is consumption-only. A stale or
     * out-of-order provider response must never replenish customer
     * entitlement. Legitimate balance increases belong to explicit
     * billing/top-up flows instead.
     */
    nextRemainingMb = Math.min(
      Math.max(
        0,
        Number(pack.remainingDataMb) || 0
      ),
      Math.max(
        0,
        nextRemainingMb
      )
    );

    const updated =
      await prisma.mobileDataPackPurchase.update({
        where: {
          id: pack.id,
        },

        data: {
          totalDataMb:
            nextTotalMb,

          remainingDataMb:
            nextRemainingMb,

          expiresAt:
            nextExpiresAt,

          /*
           * Do not rewrite ICCID/profile identity during a usage
           * refresh. A user may own multiple Subscriber records,
           * especially after an eSIM device replacement. Usage is
           * scoped by providerPurchaseId, so identity must remain
           * attached to the pack that already owns it.
           */

          /*
           * Preserve the provider package identifier used for this
           * usage lookup.
           */
          providerPurchaseId:
            String(providerUsageId),
        },
      });

    return {
      pack: updated,
      providerStatus:
        typeof usage.providerStatus === 'string'
          ? usage.providerStatus
          : null,
    };
  } catch (err) {
    console.warn(
      'provider usage refresh failed:',
      err?.message || err
    );

    return {
      pack,
      providerStatus: null,
    };
  }
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

    // // 1) Check if user is in a Family with data
    // const membership = await prisma.familyMember.findFirst({
    //   where: { userId },
    //   include: { family: true },
    // });

    // if (membership?.family) {
    //   const family = membership.family;

    //   const totalDataMb = family.totalDataMb || 0;
    //   const usedDataMb = family.usedDataMb || 0;
    //   const remainingDataMb = Math.max(0, totalDataMb - usedDataMb);

    //   const status = computeStatus(totalDataMb, remainingDataMb, family.expiresAt || null);

    //   const daysRemaining = family.expiresAt
    //     ? Math.max(
    //         0,
    //         Math.ceil(
    //           (new Date(family.expiresAt).getTime() - now.getTime()) / (1000 * 60 * 60 * 24),
    //         ),
    //       )
    //     : null;

    //   return res.json({
    //     mode: 'FAMILY',
    //     state: status.state, // "OK" | "LOW" | "EXHAUSTED" | "EXPIRED"
    //     low: status.low,
    //     exhausted: status.exhausted,
    //     expired: status.expired,
    //     source: {
    //       type: 'FAMILY_POOL',
    //       familyId: family.id,
    //       name: family.name || 'My Chatforia Family',
    //       totalDataMb,
    //       usedDataMb,
    //       remainingDataMb,
    //       expiresAt: family.expiresAt,
    //       daysRemaining,
    //     },
    //   });
    // }

    // 2) Otherwise, check individual eSIM pack.
    //
    // Provider lifecycle state wins when multiple packages share an
    // ICCID. This prevents a queued NOT_ACTIVE top-up from replacing
    // the package Telna is currently consuming.
    const resolvedPack =
      await resolveActiveIndividualPack(userId);

    const pack =
      resolvedPack.pack;

    const queuedPacks =
      Array.isArray(resolvedPack.queuedPacks)
        ? resolvedPack.queuedPacks
        : [];

    if (!pack) {
      // Check if there is an expired/zero pack to surface exhausted state
      const lastPack = await prisma.mobileDataPackPurchase.findFirst({
        where: { userId },
        orderBy: { purchasedAt: 'desc' },
      });

      if (!lastPack) {
        return res.json({
          mode: 'NONE',
          state: 'NONE',
          low: false,
          exhausted: false,
          expired: false,
          source: null,
        });
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
    // const subscriber = await prisma.subscriber.findFirst({
    //   where: { userId: Number(req.user.id) },
    // });

    const queuedPackSummaries =
      queuedPacks.map((queuedPack) => {
        const queuedRemainingDataMb =
          Math.max(
            0,
            Number(
              queuedPack.remainingDataMb
            ) || 0
          );

        return {
          id: queuedPack.id,
          addonKind: queuedPack.addonKind,
          totalDataMb:
            queuedPack.totalDataMb || 0,
          remainingDataMb:
            queuedRemainingDataMb,
          expiresAt:
            queuedPack.expiresAt ?? null,
        };
      });

    const queuedDataMb =
      queuedPackSummaries.reduce(
        (sum, queuedPack) =>
          sum +
          queuedPack.remainingDataMb,
        0
      );

    /*
     * Customer-facing aggregate only. Telna continues to meter the
     * ACTIVE and queued packages independently.
     */
    const totalAvailableDataMb =
      Math.max(0, remainingDataMb) +
      queuedDataMb;

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
      queuedPacks:
        queuedPackSummaries,
      queuedDataMb,
      totalAvailableDataMb,
    });
  } catch (err) {
    console.error('wireless status error:', err);
    return res.status(500).json({
      error: 'Failed to load wireless status',
      message: err?.message || String(err),
      stack: process.env.NODE_ENV !== 'production' ? err?.stack : undefined,
    });
  }
});

/* -------------------- eSIM device replacement ------------------ */

/**
 * POST /api/wireless/esim/:purchaseId/replace
 *
 * Replaces the authenticated customer's eSIM delivery profile while
 * preserving the remaining finite data entitlement and expiration.
 *
 * The client supplies only the Chatforia purchase ID. User ownership,
 * ICCIDs and provider package identifiers are resolved server-side.
 */
router.post(
  '/esim/:purchaseId/replace',
  async (req, res) => {
    try {
      const userId = Number(req.user?.id);
      const purchaseId =
        Number(req.params.purchaseId);

      const idempotencyKey =
        String(
          req.get('Idempotency-Key') ||
          ''
        ).trim();

      if (
        !Number.isInteger(userId) ||
        userId <= 0
      ) {
        return res
          .status(401)
          .json({
            error: 'Unauthorized',
          });
      }

      if (
        !Number.isInteger(purchaseId) ||
        purchaseId <= 0
      ) {
        return res
          .status(400)
          .json({
            error:
              'Valid purchaseId required',
          });
      }

      if (
        !idempotencyKey ||
        idempotencyKey.length > 200
      ) {
        return res
          .status(400)
          .json({
            error:
              'Valid Idempotency-Key header required',
            code:
              'ESIM_REPLACEMENT_INVALID_IDEMPOTENCY_KEY',
          });
      }

      const replacement =
        await replaceEsimForDevice({
          userId,
          purchaseId,
          idempotencyKey,
          reason:
            'DEVICE_REPLACEMENT',
        });

      return res.json({
        ok: true,
        replacement: {
          id:
            replacement.id,
          purchaseId:
            replacement.purchaseId,
          status:
            replacement.status,
          oldIccid:
            replacement.oldIccid,
          newIccid:
            replacement.newIccid ??
            null,
          remainingDataMb:
            replacement.remainingDataMb,
          expiresAt:
            replacement.originalExpiresAt ??
            null,
          createdAt:
            replacement.createdAt ??
            null,
          completedAt:
            replacement.completedAt ??
            null,

          /*
           * Installation credentials always come from the newly
           * allocated Subscriber. Never expose credentials from the
           * replaced Subscriber or reconstruct an LPA payload here.
           */
          installation: replacement.newSubscriber
            ? {
                subscriberId:
                  replacement.newSubscriber.id,
                iccid:
                  replacement.newSubscriber.iccid ??
                  null,
                providerProfileId:
                  replacement.newSubscriber
                    .providerProfileId ??
                  null,
                smdp:
                  replacement.newSubscriber.smdp ??
                  null,
                activationCode:
                  replacement.newSubscriber
                    .activationCode ??
                  null,
                lpaUri:
                  replacement.newSubscriber.lpaUri ??
                  null,
                qrPayload:
                  replacement.newSubscriber.qrPayload ??
                  null,
              }
            : null,
        },
      });
    } catch (err) {
      console.error(
        'wireless eSIM replacement error:',
        err
      );

      const code = err?.code;

      if (
        code ===
          'ESIM_REPLACEMENT_INVALID_IDEMPOTENCY_KEY'
      ) {
        return res
          .status(400)
          .json({
            error:
              err.message,
            code,
          });
      }

      if (
        code ===
          'ESIM_REPLACEMENT_IDEMPOTENCY_CONFLICT'
      ) {
        return res
          .status(409)
          .json({
            error:
              err.message,
            code,
          });
      }

      if (
        code ===
          'ESIM_REPLACEMENT_NOT_FOUND' ||
        code ===
          'ESIM_REPLACEMENT_PURCHASE_NOT_FOUND'
      ) {
        return res
          .status(404)
          .json({
            error:
              'eSIM purchase not found',
            code,
          });
      }

      if (
        code ===
          'ESIM_REPLACEMENT_UNLIMITED_UNSUPPORTED' ||
        code ===
          'ESIM_REPLACEMENT_NO_CAPACITY' ||
        code ===
          'ESIM_REPLACEMENT_EXPIRED' ||
        code ===
          'ESIM_REPLACEMENT_UNKNOWN_SCOPE' ||
        code ===
          'ESIM_REPLACEMENT_INVALID_BALANCE' ||
        code ===
          'ESIM_REPLACEMENT_EXHAUSTED' ||
        code ===
          'ESIM_REPLACEMENT_MISSING_EXPIRY' ||
        code ===
          'ESIM_REPLACEMENT_INVALID_EXPIRY' ||
        code ===
          'ESIM_REPLACEMENT_MISSING_SUBSCRIBER_IDENTITY' ||
        code ===
          'ESIM_REPLACEMENT_SUBSCRIBER_NOT_FOUND' ||
        code ===
          'ESIM_REPLACEMENT_MISSING_PACKAGE' ||
        code ===
          'ESIM_REPLACEMENT_MISSING_ICCID' ||
        code ===
          'ESIM_REPLACEMENT_USAGE_UNAVAILABLE'
      ) {
        return res
          .status(409)
          .json({
            error:
              err.message,
            code,
          });
      }

      if (
        code ===
        'ESIM_REPLACEMENT_COLLISION_UNRESOLVED'
      ) {
        return res
          .status(409)
          .json({
            error:
              'An eSIM replacement is already being processed',
            code,
          });
      }

      return res
        .status(500)
        .json({
          error:
            'Failed to replace eSIM',
          code:
            code || undefined,
        });
    }
  }
);

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
        iccid: prov.iccid ?? null,
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
          iccid: prov.iccid ?? null,
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

    // optionally mirror iccid to User.iccid for convenience
    if (sub.iccid) {
      await prisma.user.update({
        where: { id: Number(req.user.id) },
        data: { iccid: sub.iccid },
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
 * Generic receiver for provider webhooks (Telna / Plintron later)
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
        iccid: parsed.iccid ?? sub.iccid,
        msisdn: parsed.msisdn ?? sub.msisdn,
      },
    });

    // also update purchase record if linked
    if (sub.purchaseId) {
      await prisma.mobileDataPackPurchase.update({
        where: { id: sub.purchaseId },
        data: {
          iccid: parsed.iccid ?? undefined,
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