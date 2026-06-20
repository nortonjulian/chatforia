import express from 'express';
import Stripe from 'stripe';
import prisma from '../utils/prismaClient.js';
import { getAddonConfig } from '../utils/billingProducts.js';
import * as esimProvider from '../services/providers/esimProvider.js';
import { ESIM_PROVIDER } from '../config/esim.js';

const router = express.Router();

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

function stripePlanFromPriceId(priceId) {
  const id = String(priceId || '');

  if (id === String(process.env.STRIPE_PRICE_PLUS_MONTHLY)) {
    return 'PLUS';
  }

  if (
    id === String(process.env.STRIPE_PRICE_PREMIUM_MONTHLY) ||
    id === String(process.env.STRIPE_PRICE_PREMIUM_ANNUAL)
  ) {
    return 'PREMIUM';
  }

  return null;
}

function dateFromUnix(seconds) {
  if (!seconds) return null;
  const date = new Date(Number(seconds) * 1000);
  return Number.isNaN(date.getTime()) ? null : date;
}

async function hasProcessedStripeEvent(eventId) {
  const existing = await prisma.stripeWebhookEvent.findUnique({
    where: { id: String(eventId) },
  });

  return !!existing;
}

async function markStripeEventProcessed(event) {
  await prisma.stripeWebhookEvent.create({
    data: {
      id: String(event.id),
      type: String(event.type),
    },
  });
}

async function scheduleProtectedNumbersForDowngrade(userId) {
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

  await scheduleProtectedNumbersForDowngrade(userId);
}

async function findUserByStripeCustomer(customerId) {
  if (!customerId) return null;

  return prisma.user.findFirst({
    where: {
      billingCustomerId: String(customerId),
    },
    select: { id: true },
  });
}

async function findUserBySubscription(subscriptionId) {
  if (!subscriptionId) return null;

  return prisma.user.findFirst({
    where: {
      billingSubscriptionId: String(subscriptionId),
    },
    select: { id: true },
  });
}

async function applyActiveSubscription(subscription) {
  const subscriptionId = String(subscription.id);
  const customerId = String(subscription.customer);

  const item = subscription.items?.data?.[0];
  const priceId = item?.price?.id || null;
  const plan = stripePlanFromPriceId(priceId);

  const userIdFromMetadata =
    Number(subscription.metadata?.userId) ||
    Number(subscription.metadata?.user_id) ||
    null;

  let userId = Number.isFinite(userIdFromMetadata) ? userIdFromMetadata : null;

  if (!userId) {
    const userBySub = await findUserBySubscription(subscriptionId);
    userId = userBySub?.id || null;
  }

  if (!userId) {
    const userByCustomer = await findUserByStripeCustomer(customerId);
    userId = userByCustomer?.id || null;
  }

  if (!userId || !plan) {
    console.warn('[stripeWebhook] unable to apply active subscription', {
      subscriptionId,
      customerId,
      priceId,
      plan,
      userId,
    });
    return;
  }

  await prisma.user.update({
    where: { id: Number(userId) },
    data: {
      plan,
      billingProvider: 'STRIPE',
      billingCustomerId: customerId,
      billingSubscriptionId: subscriptionId,
      subscriptionStatus: String(subscription.status || 'active').toUpperCase(),
      subscriptionEndsAt: dateFromUnix(subscription.current_period_end),
      ...(subscription.status === 'active'
        ? { firstPaidAt: new Date() }
        : {}),
    },
  });
}

async function markSubscriptionCanceledOrPastDue(subscription, status) {
  const subscriptionId = String(subscription.id);
  const customerId = String(subscription.customer);

  await prisma.user.updateMany({
    where: {
      OR: [
        { billingSubscriptionId: subscriptionId },
        { billingCustomerId: customerId },
      ],
    },
    data: {
      billingProvider: 'STRIPE',
      billingCustomerId: customerId,
      billingSubscriptionId: subscriptionId,
      subscriptionStatus: status,
      subscriptionEndsAt: dateFromUnix(subscription.current_period_end),
    },
  });
}

function inferRegionFromAddon(addonKindOrProduct) {
  const value = String(addonKindOrProduct || '').toLowerCase();

  if (value.includes('europe')) return 'EU';
  if (value.includes('global')) return 'GLOBAL';

  // Default local pack to US for now.
  return 'US';
}

function addDays(date, days) {
  return new Date(date.getTime() + Number(days || 30) * 24 * 60 * 60 * 1000);
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

async function applyPaidAddonCheckoutSession(session) {
  if (session.mode !== 'payment') {
    return { ignored: true, reason: 'not-payment-mode' };
  }

  if (session.payment_status && session.payment_status !== 'paid') {
    return { ignored: true, reason: 'payment-not-paid' };
  }

  const userId =
    Number(session.metadata?.userId) ||
    Number(session.client_reference_id) ||
    null;

  if (!userId) {
    console.warn('[stripeWebhook] payment session missing userId', {
      sessionId: session.id,
    });

    return { ignored: true, reason: 'missing-user-id' };
  }

  const product = String(session.metadata?.product || '').trim();
  const addonCfg = getAddonConfig(product);

  if (!addonCfg) {
    return { ignored: true, reason: 'unknown-addon-product' };
  }

  if (addonCfg.type !== 'ESIM') {
    return { ignored: true, reason: 'not-esim-addon' };
  }

  const transactionId = String(session.payment_intent || session.id);
  const purchasedAt = new Date();
  const fallbackExpiresAt = addDays(purchasedAt, addonCfg.daysValid || 30);

  let purchase = await prisma.mobileDataPackPurchase.findFirst({
    where: {
      billingTransactionId: transactionId,
    },
  });

  if (!purchase) {
    purchase = await prisma.mobileDataPackPurchase.create({
      data: {
        userId: Number(userId),
        kind: addonCfg.type,
        addonKind: addonCfg.addonKind,
        purchasedAt,
        expiresAt: fallbackExpiresAt,
        totalDataMb: addonCfg.dataMb,
        remainingDataMb: addonCfg.dataMb,
        billingTransactionId: transactionId,
      },
    });
  }

  let subscriber = await getLatestSubscriberForUser(userId);

  let providerProfileId = subscriber?.providerProfileId || null;
  let reserve = null;

  // If this is the user's first eSIM, reserve one and save QR/manual activation details.
  if (!providerProfileId) {
    const region = inferRegionFromAddon(addonCfg.addonKind || product);

    reserve = await esimProvider.reserveEsimProfile({
      userId: Number(userId),
      region,
      addonKind: addonCfg.addonKind,
      planCode: addonCfg.addonKind,
    });

    providerProfileId = reserve?.providerProfileId || null;

    subscriber = await prisma.subscriber.create({
      data: {
        userId: Number(userId),
        purchaseId: purchase.id,
        provider: ESIM_PROVIDER || 'unknown',
        providerProfileId,
        iccid: reserve?.iccid || null,
        iccidHint: reserve?.iccidHint || reserve?.iccid || null,
        smdp: reserve?.smdp || null,
        activationCode: reserve?.activationCode || null,
        lpaUri:
          reserve?.lpaUri ||
          reserve?.qrPayload ||
          (reserve?.smdp && reserve?.activationCode
            ? `LPA:1$${reserve.smdp}$${reserve.activationCode}`
            : null),
        qrPayload:
          reserve?.qrPayload ||
          reserve?.lpaUri ||
          (reserve?.smdp && reserve?.activationCode
            ? `LPA:1$${reserve.smdp}$${reserve.activationCode}`
            : null),
        region,
        status: 'PENDING',
        providerMeta: {
          stripeSessionId: session.id,
          stripePaymentIntentId: transactionId,
          product,
          addonKind: addonCfg.addonKind,
          reserve,
        },
      },
    });

    if (reserve?.iccid) {
      await prisma.user.update({
        where: { id: Number(userId) },
        data: { iccid: reserve.iccid },
      });
    }
  }

  let providerPack = null;

  // Add/provision the purchased data pack to the provider profile when possible.
  if (providerProfileId && typeof esimProvider.provisionEsimPack === 'function') {
    providerPack = await esimProvider.provisionEsimPack({
      userId: Number(userId),
      providerProfileId: String(providerProfileId),
      addonKind: addonCfg.addonKind,
      planCode: addonCfg.addonKind,
    });
  }

  const nextExpiresAt = providerPack?.expiresAt || fallbackExpiresAt;
  const nextTotalDataMb =
    typeof providerPack?.dataMb === 'number' ? providerPack.dataMb : addonCfg.dataMb;

  await prisma.mobileDataPackPurchase.update({
    where: { id: purchase.id },
    data: {
      expiresAt: nextExpiresAt,
      totalDataMb: nextTotalDataMb,
      remainingDataMb: nextTotalDataMb,
      esimProfileId: providerProfileId || purchase.esimProfileId || null,
      iccid:
        providerPack?.iccid ||
        reserve?.iccid ||
        subscriber?.iccid ||
        purchase.iccid ||
        null,
      qrCodeSvg: providerPack?.qrCodeSvg || purchase.qrCodeSvg || null,
    },
  });

  if (subscriber?.id) {
    const nextProviderMeta = {
      ...(subscriber.providerMeta || {}),
      stripeSessionId: session.id,
      stripePaymentIntentId: transactionId,
      product,
      addonKind: addonCfg.addonKind,
    };

    if (reserve) {
      nextProviderMeta.reserve = reserve;
    }

    if (providerPack) {
      nextProviderMeta.providerPack = providerPack;
    }

    await prisma.subscriber.update({
      where: { id: subscriber.id },
      data: {
        purchaseId: purchase.id,
        providerProfileId: providerProfileId || subscriber.providerProfileId || null,
        iccid:
          providerPack?.iccid ||
          reserve?.iccid ||
          subscriber.iccid ||
          null,
        expiresAt: nextExpiresAt,
        providerMeta: nextProviderMeta,
      },
    });
  }

  return {
    ignored: false,
    kind: 'esim-addon',
    purchaseId: purchase.id,
    subscriberId: subscriber?.id || null,
  };
}

router.post(
  '/',
  async (req, res) => {
    const signature = req.get('stripe-signature');
    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

    let event;

    try {
      event = stripe.webhooks.constructEvent(
        req.body,
        signature,
        webhookSecret
      );
    } catch (err) {
      console.error('[stripeWebhook] signature verification failed:', err.message);
      return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    try {
      if (await hasProcessedStripeEvent(event.id)) {
        console.log('[stripeWebhook] duplicate event skipped:', event.id);

        return res.json({
          received: true,
          duplicate: true,
        });
      }

      switch (event.type) {
        case 'checkout.session.completed': {
          const session = event.data.object;

          if (session.mode === 'payment') {
            const result = await applyPaidAddonCheckoutSession(session);

            console.log('[stripeWebhook] payment checkout handled:', {
              sessionId: session.id,
              result,
            });

            break;
          }

          if (session.mode !== 'subscription' || !session.subscription) {
            break;
          }

          const subscription = await stripe.subscriptions.retrieve(
            session.subscription
          );

          if (!subscription.metadata?.userId && session.metadata?.userId) {
            await stripe.subscriptions.update(subscription.id, {
              metadata: {
                ...subscription.metadata,
                userId: String(session.metadata.userId),
                plan: String(session.metadata.plan || ''),
              },
            });

            subscription.metadata.userId = String(session.metadata.userId);
            subscription.metadata.plan = String(session.metadata.plan || '');
          }

          await applyActiveSubscription(subscription);
          break;
        }

        case 'customer.subscription.created':
        case 'customer.subscription.updated':
        case 'invoice.payment_succeeded': {
          let subscription;

          if (event.type === 'invoice.payment_succeeded') {
            const invoice = event.data.object;
            if (!invoice.subscription) break;
            subscription = await stripe.subscriptions.retrieve(invoice.subscription);
          } else {
            subscription = event.data.object;
          }

          if (['active', 'trialing'].includes(subscription.status)) {
            await applyActiveSubscription(subscription);
          } else if (subscription.status === 'past_due') {
            await markSubscriptionCanceledOrPastDue(subscription, 'PAST_DUE');
          } else if (
            ['canceled', 'unpaid', 'incomplete_expired'].includes(subscription.status)
          ) {
            const subId = String(subscription.id);
            const customerId = String(subscription.customer);

            const users = await prisma.user.findMany({
              where: {
                OR: [
                  { billingSubscriptionId: subId },
                  { billingCustomerId: customerId },
                ],
              },
              select: { id: true },
            });

            for (const user of users) {
              await downgradeUserToFree(user.id, {
                billingProvider: 'STRIPE',
                billingCustomerId: customerId,
                billingSubscriptionId: subId,
              });
            }
          }
          break;
        }

        case 'customer.subscription.deleted': {
          const subscription = event.data.object;
          const subId = String(subscription.id);
          const customerId = String(subscription.customer);

          const users = await prisma.user.findMany({
            where: {
              OR: [
                { billingSubscriptionId: subId },
                { billingCustomerId: customerId },
              ],
            },
            select: { id: true },
          });

          for (const user of users) {
            await downgradeUserToFree(user.id, {
              billingProvider: 'STRIPE',
              billingCustomerId: customerId,
              billingSubscriptionId: subId,
            });
          }

          break;
        }

        case 'invoice.payment_failed': {
          const invoice = event.data.object;
          if (!invoice.subscription) break;

          const subscription = await stripe.subscriptions.retrieve(
            invoice.subscription
          );

          await markSubscriptionCanceledOrPastDue(subscription, 'PAST_DUE');
          break;
        }

        default:
          break;
      }

      await markStripeEventProcessed(event);

      return res.json({
        received: true,
      });
    } catch (err) {
      console.error('[stripeWebhook] handler failed:', err);
      return res.status(500).json({ error: 'Webhook handler failed' });
    }
  }
);

export default router;