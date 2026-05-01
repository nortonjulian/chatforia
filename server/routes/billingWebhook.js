import express from 'express';
import crypto from 'node:crypto';
import prisma from '../utils/prismaClient.js';

const router = express.Router();

function safeEqual(a, b) {
  try {
    return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
  } catch {
    return false;
  }
}

function verifyLemonSignature(rawBody, signature, secret) {
  if (!rawBody || !signature || !secret) return false;

  const expected = crypto
    .createHmac('sha256', secret)
    .update(rawBody)
    .digest('hex');

  return safeEqual(expected, signature);
}

function planFromVariantId(variantId) {
  const id = String(variantId || '');

  if (id === String(process.env.LEMONSQUEEZY_VARIANT_PLUS_MONTHLY)) {
    return 'PLUS';
  }

  if (
    id === String(process.env.LEMONSQUEEZY_VARIANT_PREMIUM_MONTHLY) ||
    id === String(process.env.LEMONSQUEEZY_VARIANT_PREMIUM_ANNUAL)
  ) {
    return 'PREMIUM';
  }

  return null;
}

function parseDate(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

async function downgradeUserToFree(userId, patch = {}) {
  await prisma.user.update({
    where: { id: Number(userId) },
    data: {
      plan: 'FREE',
      subscriptionStatus: 'EXPIRED',
      subscriptionEndsAt: null,
      theme: 'dawn',
      messageTone: 'Default.mp3',
      ringtone: 'Classic.mp3',
      ...patch,
    },
  });

  const holdDays = Number(process.env.NUMBER_HOLD_DAYS) || 14;
  const holdUntil = new Date(Date.now() + holdDays * 24 * 60 * 60 * 1000);

  await prisma.phoneNumber.updateMany({
    where: {
      assignedUserId: Number(userId),
      status: 'ASSIGNED',
      keepLocked: true,
    },
    data: {
      keepLocked: false,
      holdUntil,
      releaseAfter: null,
      isLeasable: false,
      isPurchasable: false,
    },
  });
}

router.post(
  '/webhook',
  express.raw({ type: 'application/json' }),
  async (req, res) => {
    const rawBody = req.body?.toString('utf8') || '';
    const signature = req.get('X-Signature');
    const secret = process.env.LEMONSQUEEZY_WEBHOOK_SECRET;

    const skipVerification =
      process.env.NODE_ENV === 'test' ||
      process.env.LEMONSQUEEZY_SKIP_SIG_CHECK === 'true';

    if (!skipVerification && !verifyLemonSignature(rawBody, signature, secret)) {
      return res.status(401).json({ error: 'Invalid Lemon Squeezy signature' });
    }

    let payload;

    try {
      payload = JSON.parse(rawBody);
    } catch (err) {
      console.error('[lemonWebhook] invalid JSON', err);
      return res.status(400).json({ error: 'Invalid JSON' });
    }

    const eventName = payload?.meta?.event_name;
    const customData = payload?.meta?.custom_data || {};
    const attrs = payload?.data?.attributes || {};

    const userId = Number(customData.userId || customData.user_id);
    const variantId = attrs.variant_id || attrs.first_subscription_item?.variant_id;
    const plan = planFromVariantId(variantId);

    const subscriptionId = payload?.data?.id ? String(payload.data.id) : null;
    const customerId = attrs.customer_id ? String(attrs.customer_id) : null;

    const renewsAt = parseDate(attrs.renews_at);
    const endsAt = parseDate(attrs.ends_at);

    try {
      switch (eventName) {
        case 'subscription_created':
        case 'subscription_updated':
        case 'subscription_resumed': {
          if (!userId || !plan) {
            console.warn('[lemonWebhook] missing userId or plan', {
              eventName,
              userId,
              variantId,
            });
            break;
          }

          await prisma.user.update({
            where: { id: userId },
            data: {
              plan,
              billingProvider: 'LEMONSQUEEZY',
              billingCustomerId: customerId,
              billingSubscriptionId: subscriptionId,
              subscriptionStatus: 'ACTIVE',
              subscriptionEndsAt: renewsAt || endsAt,
              firstPaidAt: eventName === 'subscription_created' ? new Date() : undefined,
            },
          });

          break;
        }

        case 'subscription_cancelled': {
          if (!subscriptionId) break;

          await prisma.user.updateMany({
            where: { billingSubscriptionId: subscriptionId },
            data: {
              billingProvider: 'LEMONSQUEEZY',
              subscriptionStatus: 'CANCELED',
              subscriptionEndsAt: endsAt || renewsAt,
            },
          });

          break;
        }

        case 'subscription_expired': {
          if (userId) {
            await downgradeUserToFree(userId, {
              billingProvider: 'LEMONSQUEEZY',
              billingCustomerId: customerId,
              billingSubscriptionId: subscriptionId,
            });
          } else if (subscriptionId) {
            const users = await prisma.user.findMany({
              where: { billingSubscriptionId: subscriptionId },
              select: { id: true },
            });

            for (const user of users) {
              await downgradeUserToFree(user.id, {
                billingProvider: 'LEMONSQUEEZY',
                billingCustomerId: customerId,
                billingSubscriptionId: subscriptionId,
              });
            }
          }

          break;
        }

        case 'subscription_payment_failed': {
          if (!subscriptionId) break;

          await prisma.user.updateMany({
            where: { billingSubscriptionId: subscriptionId },
            data: {
              billingProvider: 'LEMONSQUEEZY',
              subscriptionStatus: 'PAST_DUE',
              subscriptionEndsAt: renewsAt || endsAt,
            },
          });

          break;
        }

        default:
          break;
      }

      return res.json({ received: true });
    } catch (err) {
      console.error('[lemonWebhook] handler failed', err);
      return res.status(500).json({ error: 'Webhook handler failed' });
    }
  }
);

export default router;