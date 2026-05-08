import express from 'express';
import Stripe from 'stripe';
import prisma from '../utils/prismaClient.js';

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

router.post(
  '/webhook',
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
      switch (event.type) {
        case 'checkout.session.completed': {
          const session = event.data.object;

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

      return res.json({ received: true });
    } catch (err) {
      console.error('[stripeWebhook] handler failed:', err);
      return res.status(500).json({ error: 'Webhook handler failed' });
    }
  }
);

export default router;