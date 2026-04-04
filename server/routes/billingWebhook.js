import express from 'express';
import crypto from 'node:crypto';
import prisma from '../utils/prismaClient.js';

const router = express.Router();

function parsePaddleSignatureHeader(headerValue) {
  const parts = String(headerValue || '')
    .split(';')
    .map((x) => x.trim())
    .filter(Boolean);

  let timestamp = null;
  const signatures = [];

  for (const part of parts) {
    const [key, value] = part.split('=');
    if (!key || !value) continue;
    if (key === 'ts') timestamp = value;
    if (key === 'h1') signatures.push(value);
  }

  return { timestamp, signatures };
}

function safeEqualHex(a, b) {
  try {
    return crypto.timingSafeEqual(
      Buffer.from(String(a), 'hex'),
      Buffer.from(String(b), 'hex')
    );
  } catch {
    return false;
  }
}

function verifyPaddleSignature(rawBody, headerValue, secret) {
  if (!rawBody || !headerValue || !secret) return false;

  const { timestamp, signatures } = parsePaddleSignatureHeader(headerValue);
  if (!timestamp || !signatures.length) return false;

  const signedPayload = `${timestamp}:${rawBody}`;
  const expected = crypto
    .createHmac('sha256', secret)
    .update(signedPayload, 'utf8')
    .digest('hex');

  return signatures.some((sig) => safeEqualHex(sig, expected));
}

function firstNonNull(...values) {
  for (const v of values) {
    if (v !== undefined && v !== null && v !== '') return v;
  }
  return null;
}

function mapPriceIdToPlan(priceId) {
  const map = {
    [process.env.PADDLE_PRICE_PLUS_MONTHLY]: 'PLUS',
    [process.env.PADDLE_PRICE_PREMIUM_MONTHLY]: 'PREMIUM',
    [process.env.PADDLE_PRICE_PREMIUM_ANNUAL]: 'PREMIUM',
    [process.env.PADDLE_PRICE_WIRELESS_MONTHLY]: 'WIRELESS',
  };

  return map[priceId] || 'FREE';
}

function getPriceIdFromEventData(data) {
  const item = data?.items?.[0] || data?.subscription_items?.[0] || null;
  return firstNonNull(item?.price?.id, item?.price_id);
}

function getUserIdFromEventData(data) {
  const customData = data?.custom_data || {};
  const userId = firstNonNull(
    customData.userId,
    customData.user_id,
    data?.customer?.custom_data?.userId,
    data?.customer?.custom_data?.user_id
  );

  const n = Number(userId);
  return Number.isFinite(n) ? n : null;
}

function getCustomerIdFromEventData(data) {
  const value = firstNonNull(data?.customer_id, data?.customer?.id);
  return value ? String(value) : null;
}

function getSubscriptionIdFromEventData(data) {
  const value = firstNonNull(data?.subscription_id, data?.id);
  return value ? String(value) : null;
}

function getPeriodEndFromEventData(data) {
  const raw = firstNonNull(
    data?.current_billing_period?.ends_at,
    data?.next_billed_at
  );

  if (!raw) return null;

  const dt = new Date(raw);
  return Number.isNaN(dt.getTime()) ? null : dt;
}

async function downgradeUserToFree(userId, billingPatch = {}) {
  await prisma.user.update({
    where: { id: Number(userId) },
    data: {
      plan: 'FREE',
      subscriptionStatus: 'EXPIRED',
      subscriptionEndsAt: null,
      theme: 'dawn',
      messageTone: 'Default.mp3',
      ringtone: 'Classic.mp3',
      ...billingPatch,
    },
  });
}

async function updateUserById(userId, patch) {
  if (!userId) return 0;

  await prisma.user.update({
    where: { id: Number(userId) },
    data: patch,
  });

  return 1;
}

async function updateUserBySubscriptionId(subscriptionId, patch) {
  if (!subscriptionId) return 0;

  const result = await prisma.user.updateMany({
    where: { billingSubscriptionId: String(subscriptionId) },
    data: patch,
  });

  return result.count || 0;
}

async function handleAddonPurchase(data) {
  const customData = data?.custom_data || {};
  const userId = Number(customData.userId);
  const addonKind = customData.addonKind || null;

  if (!Number.isFinite(userId) || !addonKind) return;

  const ADDON_CONFIG = {
  // Local
  chatforia_esim_local_3: { type: 'ESIM', dataMb: 3 * 1024, daysValid: 30 },
  chatforia_esim_local_5: { type: 'ESIM', dataMb: 5 * 1024, daysValid: 30 },
  chatforia_esim_local_10: { type: 'ESIM', dataMb: 10 * 1024, daysValid: 30 },
  chatforia_esim_local_20: { type: 'ESIM', dataMb: 20 * 1024, daysValid: 30 },
  chatforia_esim_local_unlimited: { type: 'ESIM', dataMb: null, daysValid: 30 },

  // Europe
  chatforia_esim_europe_3: { type: 'ESIM', dataMb: 3 * 1024, daysValid: 30 },
  chatforia_esim_europe_5: { type: 'ESIM', dataMb: 5 * 1024, daysValid: 30 },
  chatforia_esim_europe_10: { type: 'ESIM', dataMb: 10 * 1024, daysValid: 30 },
  chatforia_esim_europe_20: { type: 'ESIM', dataMb: 20 * 1024, daysValid: 30 },
  chatforia_esim_europe_unlimited: { type: 'ESIM', dataMb: null, daysValid: 30 },

  // Global
  chatforia_esim_global_3: { type: 'ESIM', dataMb: 3 * 1024, daysValid: 30 },
  chatforia_esim_global_5: { type: 'ESIM', dataMb: 5 * 1024, daysValid: 30 },
  chatforia_esim_global_10: { type: 'ESIM', dataMb: 10 * 1024, daysValid: 30 },
  chatforia_esim_global_unlimited: { type: 'ESIM', dataMb: null, daysValid: 30 },

  // Premium aliases
  chatforia_esim_local_3_premium: { type: 'ESIM', dataMb: 3 * 1024, daysValid: 30 },
  chatforia_esim_local_5_premium: { type: 'ESIM', dataMb: 5 * 1024, daysValid: 30 },
  chatforia_esim_local_10_premium: { type: 'ESIM', dataMb: 10 * 1024, daysValid: 30 },
  chatforia_esim_local_20_premium: { type: 'ESIM', dataMb: 20 * 1024, daysValid: 30 },
  chatforia_esim_local_unlimited_premium: { type: 'ESIM', dataMb: null, daysValid: 30 },

  chatforia_esim_europe_3_premium: { type: 'ESIM', dataMb: 3 * 1024, daysValid: 30 },
  chatforia_esim_europe_5_premium: { type: 'ESIM', dataMb: 5 * 1024, daysValid: 30 },
  chatforia_esim_europe_10_premium: { type: 'ESIM', dataMb: 10 * 1024, daysValid: 30 },
  chatforia_esim_europe_20_premium: { type: 'ESIM', dataMb: 20 * 1024, daysValid: 30 },
  chatforia_esim_europe_unlimited_premium: { type: 'ESIM', dataMb: null, daysValid: 30 },

  chatforia_esim_global_3_premium: { type: 'ESIM', dataMb: 3 * 1024, daysValid: 30 },
  chatforia_esim_global_5_premium: { type: 'ESIM', dataMb: 5 * 1024, daysValid: 30 },
  chatforia_esim_global_10_premium: { type: 'ESIM', dataMb: 10 * 1024, daysValid: 30 },
  chatforia_esim_global_unlimited_premium: { type: 'ESIM', dataMb: null, daysValid: 30 },

  // Standard aliases
  chatforia_esim_local_3_standard: { type: 'ESIM', dataMb: 3 * 1024, daysValid: 30 },
  chatforia_esim_local_5_standard: { type: 'ESIM', dataMb: 5 * 1024, daysValid: 30 },
  chatforia_esim_local_10_standard: { type: 'ESIM', dataMb: 10 * 1024, daysValid: 30 },
  chatforia_esim_local_20_standard: { type: 'ESIM', dataMb: 20 * 1024, daysValid: 30 },
  chatforia_esim_local_unlimited_standard: { type: 'ESIM', dataMb: null, daysValid: 30 },

  chatforia_esim_europe_3_standard: { type: 'ESIM', dataMb: 3 * 1024, daysValid: 30 },
  chatforia_esim_europe_5_standard: { type: 'ESIM', dataMb: 5 * 1024, daysValid: 30 },
  chatforia_esim_europe_10_standard: { type: 'ESIM', dataMb: 10 * 1024, daysValid: 30 },
  chatforia_esim_europe_20_standard: { type: 'ESIM', dataMb: 20 * 1024, daysValid: 30 },
  chatforia_esim_europe_unlimited_standard: { type: 'ESIM', dataMb: null, daysValid: 30 },

  chatforia_esim_global_3_standard: { type: 'ESIM', dataMb: 3 * 1024, daysValid: 30 },
  chatforia_esim_global_5_standard: { type: 'ESIM', dataMb: 5 * 1024, daysValid: 30 },
  chatforia_esim_global_10_standard: { type: 'ESIM', dataMb: 10 * 1024, daysValid: 30 },
  chatforia_esim_global_unlimited_standard: { type: 'ESIM', dataMb: null, daysValid: 30 },
};

const PRODUCT_ALIASES = {
  chatforia_esim_local_3: 'chatforia_esim_local_3_premium',
  chatforia_esim_local_5: 'chatforia_esim_local_5_premium',
  chatforia_esim_local_10: 'chatforia_esim_local_10_premium',
  chatforia_esim_local_20: 'chatforia_esim_local_20_premium',
  chatforia_esim_local_unlimited: 'chatforia_esim_local_unlimited_premium',

  chatforia_esim_europe_3: 'chatforia_esim_europe_3_premium',
  chatforia_esim_europe_5: 'chatforia_esim_europe_5_premium',
  chatforia_esim_europe_10: 'chatforia_esim_europe_10_premium',
  chatforia_esim_europe_20: 'chatforia_esim_europe_20_premium',
  chatforia_esim_europe_unlimited: 'chatforia_esim_europe_unlimited_premium',

  chatforia_esim_global_3: 'chatforia_esim_global_3_premium',
  chatforia_esim_global_5: 'chatforia_esim_global_5_premium',
  chatforia_esim_global_10: 'chatforia_esim_global_10_premium',
  chatforia_esim_global_unlimited: 'chatforia_esim_global_unlimited_premium',
};

// stripePriceId

// function normalizeAddonKind(kind) {
//   return PRODUCT_ALIASES[kind] || kind;
// }

// const ADDON_CONFIG = {
//   chatforia_esim_local_3_premium: { type: 'ESIM', dataMb: 3 * 1024, daysValid: 30 },
//   chatforia_esim_local_5_premium: { type: 'ESIM', dataMb: 5 * 1024, daysValid: 30 },
//   chatforia_esim_local_10_premium: { type: 'ESIM', dataMb: 10 * 1024, daysValid: 30 },
//   chatforia_esim_local_20_premium: { type: 'ESIM', dataMb: 20 * 1024, daysValid: 30 },
//   chatforia_esim_local_unlimited_premium: { type: 'ESIM', dataMb: null, daysValid: 30 },

//   chatforia_esim_europe_3_premium: { type: 'ESIM', dataMb: 3 * 1024, daysValid: 30 },
//   chatforia_esim_europe_5_premium: { type: 'ESIM', dataMb: 5 * 1024, daysValid: 30 },
//   chatforia_esim_europe_10_premium: { type: 'ESIM', dataMb: 10 * 1024, daysValid: 30 },
//   chatforia_esim_europe_20_premium: { type: 'ESIM', dataMb: 20 * 1024, daysValid: 30 },
//   chatforia_esim_europe_unlimited_premium: { type: 'ESIM', dataMb: null, daysValid: 30 },

//   chatforia_esim_global_3_premium: { type: 'ESIM', dataMb: 3 * 1024, daysValid: 30 },
//   chatforia_esim_global_5_premium: { type: 'ESIM', dataMb: 5 * 1024, daysValid: 30 },
//   chatforia_esim_global_10_premium: { type: 'ESIM', dataMb: 10 * 1024, daysValid: 30 },
//   chatforia_esim_global_unlimited_premium: { type: 'ESIM', dataMb: null, daysValid: 30 },
// };

  const cfg = ADDON_CONFIG[addonKind];
  if (!cfg) return;

  const now = new Date();
  const expiresAt = new Date(now.getTime() + cfg.daysValid * 24 * 60 * 60 * 1000);

  await prisma.mobileDataPackPurchase.create({
    data: {
      userId,
      kind: cfg.type,
      addonKind,
      purchasedAt: now,
      expiresAt,
      totalDataMb: cfg.dataMb,
      remainingDataMb: cfg.dataMb,
    },
  });
}

router.post('/webhook', async (req, res) => {
  const secret = process.env.PADDLE_WEBHOOK_SECRET;
  const signatureHeader = req.get('Paddle-Signature');

  const rawBody = Buffer.isBuffer(req.body)
    ? req.body.toString('utf8')
    : typeof req.body === 'string'
    ? req.body
    : JSON.stringify(req.body ?? {});

  const skipVerification =
    process.env.NODE_ENV === 'test' ||
    process.env.PADDLE_SKIP_SIG_CHECK === 'true';

  if (!skipVerification) {
    const verified = verifyPaddleSignature(rawBody, signatureHeader, secret);
    if (!verified) {
      return res.status(401).json({ error: 'Invalid Paddle signature' });
    }
  }

  let payload;
  try {
    payload =
      typeof req.body === 'object' && !Buffer.isBuffer(req.body)
        ? req.body
        : JSON.parse(rawBody);
  } catch (err) {
    console.error('[billingWebhook] invalid JSON', err);
    return res.status(400).json({ error: 'Invalid JSON payload' });
  }

  const eventType = payload?.event_type || '';
  const data = payload?.data || {};

  try {
    const userId = getUserIdFromEventData(data);
    const subscriptionId = getSubscriptionIdFromEventData(data);
    const customerId = getCustomerIdFromEventData(data);
    const priceId = getPriceIdFromEventData(data);
    const plan = mapPriceIdToPlan(priceId);
    const periodEnd = getPeriodEndFromEventData(data);

    const billingPatch = {
      billingProvider: 'PADDLE',
      billingCustomerId: customerId,
      billingSubscriptionId: subscriptionId,
    };

    switch (eventType) {
      case 'transaction.completed': {
        const customData = data?.custom_data || {};
        if (customData?.kind === 'ADDON' && customData?.addonKind) {
          await handleAddonPurchase(data);
        }
        break;
      }

      case 'subscription.created':
      case 'subscription.activated':
      case 'subscription.updated':
      case 'subscription.resumed': {
        const patch = {
          plan,
          subscriptionStatus: 'ACTIVE',
          subscriptionEndsAt: periodEnd,
          ...billingPatch,
        };

        let updated = 0;
        if (userId) updated = await updateUserById(userId, patch);
        if (!updated && subscriptionId) {
          updated = await updateUserBySubscriptionId(subscriptionId, patch);
        }

        if (!updated) {
          console.warn('[billingWebhook] no user matched active subscription event', {
            eventType,
            userId,
            subscriptionId,
            customerId,
          });
        }
        break;
      }

      case 'subscription.canceled': {
        const patch = {
          subscriptionStatus: 'CANCELED',
          subscriptionEndsAt: periodEnd,
          ...billingPatch,
        };

        let updated = 0;
        if (userId) updated = await updateUserById(userId, patch);
        if (!updated && subscriptionId) {
          updated = await updateUserBySubscriptionId(subscriptionId, patch);
        }

        if (!updated) {
          console.warn('[billingWebhook] no user matched canceled subscription event', {
            eventType,
            userId,
            subscriptionId,
            customerId,
          });
        }
        break;
      }

      case 'subscription.past_due': {
        const patch = {
          subscriptionStatus: 'PAST_DUE',
          subscriptionEndsAt: periodEnd,
          ...billingPatch,
        };

        let updated = 0;
        if (userId) updated = await updateUserById(userId, patch);
        if (!updated && subscriptionId) {
          updated = await updateUserBySubscriptionId(subscriptionId, patch);
        }

        if (!updated) {
          console.warn('[billingWebhook] no user matched past_due event', {
            eventType,
            userId,
            subscriptionId,
            customerId,
          });
        }
        break;
      }

      case 'subscription.expired': {
        let handled = false;

        if (userId) {
          await downgradeUserToFree(userId, billingPatch);
          handled = true;
        } else if (subscriptionId) {
          const users = await prisma.user.findMany({
            where: { billingSubscriptionId: subscriptionId },
            select: { id: true },
          });

          for (const u of users) {
            await downgradeUserToFree(u.id, billingPatch);
          }

          handled = users.length > 0;
        }

        if (!handled) {
          console.warn('[billingWebhook] no user matched expired subscription event', {
            eventType,
            userId,
            subscriptionId,
            customerId,
          });
        }
        break;
      }

      default:
        break;
    }

    return res.json({ received: true });
  } catch (err) {
    console.error('[billingWebhook] handler failed', err);
    return res.status(500).json({ error: 'Webhook handler failed' });
  }
});

export default router;