import express from 'express';
import Stripe from 'stripe';
import prisma from '../utils/prismaClient.js';
import { getAddonConfig } from '../utils/billingProducts.js';
import * as esimProvider from '../services/providers/esimProvider.js';
import { ESIM_PROVIDER } from '../config/esim.js';
import {
  assertAppSubscriptionProviderAvailable,
  recomputeUserAppEntitlement,
} from '../services/appEntitlementService.js';

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

function getSubscriptionPeriod(subscription) {
  const item = subscription.items?.data?.[0];

  return {
    startsAt: dateFromUnix(
      item?.current_period_start ??
        subscription.current_period_start
    ),
    endsAt: dateFromUnix(
      item?.current_period_end ??
        subscription.current_period_end
    ),
  };
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


async function findUserByStripeCustomer(customerId) {
  if (!customerId) return null;

  return prisma.user.findFirst({
    where: {
      billingCustomerId: String(customerId),
    },
    select: { id: true },
  });
}

async function findUserBySubscription(
  subscriptionId
) {
  if (!subscriptionId) {
    return null;
  }

  const appSubscription =
    await prisma.appSubscription.findUnique({
      where: {
        provider_providerSubscriptionKey: {
          provider: 'STRIPE',
          providerSubscriptionKey:
            String(subscriptionId),
        },
      },

      select: {
        userId: true,
      },
    });

  return appSubscription
    ? { id: appSubscription.userId }
    : null;
}

async function applyActiveSubscription(
  subscription
) {
  const subscriptionId =
    String(subscription.id);

  const customerId =
    String(subscription.customer);

  const item =
    subscription.items?.data?.[0];

  const {
    startsAt: subscriptionStartsAt,
    endsAt: subscriptionEndsAt,
  } = getSubscriptionPeriod(subscription);

  const priceId =
    item?.price?.id || null;

  const plan =
    stripePlanFromPriceId(priceId);

  const userIdFromMetadata =
    Number(subscription.metadata?.userId) ||
    Number(subscription.metadata?.user_id) ||
    null;

  let userId =
    Number.isFinite(userIdFromMetadata)
      ? userIdFromMetadata
      : null;

  if (!userId) {
    const userBySub =
      await findUserBySubscription(
        subscriptionId
      );

    userId =
      userBySub?.id || null;
  }

  if (!userId) {
    const userByCustomer =
      await findUserByStripeCustomer(
        customerId
      );

    userId =
      userByCustomer?.id || null;
  }

  if (!userId || !plan || !priceId) {
    console.warn(
      '[stripeWebhook] unable to apply active subscription',
      {
        subscriptionId,
        customerId,
        priceId,
        plan,
        userId,
      }
    );

    return {
      ignored: true,
      reason:
        'missing-user-or-supported-plan',
    };
  }

  const now = new Date();

  try {
    return await prisma.$transaction(
      async (tx) => {
        const existingStripeSubscription =
          await tx.appSubscription.findUnique({
            where: {
              provider_providerSubscriptionKey: {
                provider: 'STRIPE',
                providerSubscriptionKey:
                  subscriptionId,
              },
            },

            select: {
              id: true,
              userId: true,
              grantsAccess: true,
              startsAt: true,
              endsAt: true,
            },
          });

        if (
          existingStripeSubscription &&
          existingStripeSubscription.userId !==
            Number(userId)
        ) {
          const error =
            new Error(
              'This Stripe subscription is already linked to another Chatforia account.'
            );

          error.code =
            'STRIPE_SUBSCRIPTION_ALREADY_LINKED';

          throw error;
        }

        const existingStripeIsCurrentlyActive =
          Boolean(
            existingStripeSubscription?.grantsAccess
          ) &&
          (
            !existingStripeSubscription.startsAt ||
            existingStripeSubscription.startsAt <= now
          ) &&
          (
            !existingStripeSubscription.endsAt ||
            existingStripeSubscription.endsAt > now
          );

        if (!existingStripeIsCurrentlyActive) {
          await assertAppSubscriptionProviderAvailable(
            userId,
            'STRIPE',
            {
              db: tx,
              now,
            }
          );
        }

        const status =
          String(
            subscription.status || 'active'
          ).toUpperCase();

        await tx.appSubscription.upsert({
          where: {
            provider_providerSubscriptionKey: {
              provider: 'STRIPE',
              providerSubscriptionKey:
                subscriptionId,
            },
          },

          create: {
            userId: Number(userId),
            provider: 'STRIPE',
            providerSubscriptionKey:
              subscriptionId,

            customerReference:
              customerId,

            productId:
              priceId,

            basePlanId:
              null,

            plan,

            status,

            grantsAccess:
              ['ACTIVE', 'TRIALING', 'PAST_DUE']
                .includes(status),

            autoRenewEnabled:
              !subscription
                .cancel_at_period_end,

            startsAt: subscriptionStartsAt,
            endsAt: subscriptionEndsAt,

            lastVerifiedAt:
              now,

            rawResponse: {
              source: 'stripe-webhook',
              livemode:
                Boolean(
                  subscription.livemode
                ),
            },
          },

          update: {
            customerReference:
              customerId,

            productId:
              priceId,

            plan,

            status,

            grantsAccess:
              ['ACTIVE', 'TRIALING', 'PAST_DUE']
                .includes(status),

            autoRenewEnabled:
              !subscription
                .cancel_at_period_end,

            startsAt: subscriptionStartsAt,
            endsAt: subscriptionEndsAt,

            lastVerifiedAt:
              now,

            rawResponse: {
              source: 'stripe-webhook',
              livemode:
                Boolean(
                  subscription.livemode
                ),
            },
          },
        });

        // The Stripe customer ID may remain on the user
        // even when wireless products are purchased later.
        await tx.user.update({
          where: {
            id: Number(userId),
          },

          data: {
            billingCustomerId:
              customerId,
          },
        });

        return recomputeUserAppEntitlement(
          userId,
          {
            db: tx,
            now,
          }
        );
      }
    );
  } catch (error) {
    if (
      error?.code ===
      'APP_SUBSCRIPTION_PROVIDER_CONFLICT'
    ) {
      console.error(
        '[stripeWebhook] Stripe app subscription blocked by active provider',
        {
          userId,
          subscriptionId,
          requestedProvider: 'STRIPE',
          currentProvider:
            error.currentProvider ?? null,
        }
      );

      // Do not let Stripe overwrite the active
      // Google Play or Apple entitlement.
      return {
        ignored: true,
        reason:
          'app-subscription-provider-conflict',
        currentProvider:
          error.currentProvider ?? null,
      };
    }

    throw error;
  }
}

async function markSubscriptionCanceledOrPastDue(
  subscription,
  status
) {
  const subscriptionId =
    String(subscription.id);

  const customerId =
    String(subscription.customer);

  const normalizedStatus =
    String(status || '')
      .trim()
      .toUpperCase();

  const existing =
    await prisma.appSubscription.findUnique({
      where: {
        provider_providerSubscriptionKey: {
          provider: 'STRIPE',
          providerSubscriptionKey:
            subscriptionId,
        },
      },

      select: {
        userId: true,
      },
    });

  if (!existing) {
    console.warn(
      '[stripeWebhook] Stripe entitlement not found for status update',
      {
        subscriptionId,
        customerId,
        status: normalizedStatus,
      }
    );

    return {
      ignored: true,
      reason:
        'stripe-app-subscription-not-found',
    };
  }

  const now = new Date();

  const {
    endsAt: subscriptionEndsAt,
  } = getSubscriptionPeriod(subscription);

  const keepsAccess =
    normalizedStatus === 'PAST_DUE';

  const entitlementResult =
    await prisma.$transaction(
      async (tx) => {
        await tx.appSubscription.update({
          where: {
            provider_providerSubscriptionKey: {
              provider: 'STRIPE',
              providerSubscriptionKey:
                subscriptionId,
            },
          },

          data: {
            status:
              normalizedStatus,

            grantsAccess:
              keepsAccess,

            autoRenewEnabled:
              keepsAccess
                ? !subscription.cancel_at_period_end
                : false,

            endsAt: subscriptionEndsAt || now,

            lastVerifiedAt:
              now,

            rawResponse: {
              source: 'stripe-webhook',
              status:
                normalizedStatus,
              livemode:
                Boolean(
                  subscription.livemode
                ),
            },
          },
        });

        return recomputeUserAppEntitlement(
          existing.userId,
          {
            db: tx,
            now,
          }
        );
      }
    );

  if (
    entitlementResult.user.plan === 'FREE'
  ) {
    await prisma.user.update({
      where: {
        id: existing.userId,
      },

      data: {
        theme: 'dawn',
        messageTone: 'Default.mp3',
        ringtone: 'Classic.mp3',
      },
    });

    await scheduleProtectedNumbersForDowngrade(
      existing.userId
    );
  }

  return entitlementResult;
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

async function getReusableSubscriberForUser(userId) {
  return prisma.subscriber.findFirst({
    where: {
      userId: Number(userId),

      providerProfileId: {
        not: null,
      },

      status: {
        in: [
          'PENDING',
          'ACTIVE',
          'SUSPENDED',
        ],
      },
    },

    orderBy: [
      {
        activatedAt: 'desc',
      },
      {
        createdAt: 'desc',
      },
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
  const fallbackExpiresAt = addDays(
    purchasedAt,
    addonCfg.daysValid || 30
  );

  const purchasedDataMb =
    Number.isInteger(addonCfg.dataMb) &&
    addonCfg.dataMb >= 0
      ? addonCfg.dataMb
      : 0;

  const isSandboxCheckout =
    session.livemode === false;

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
        totalDataMb: purchasedDataMb,
        remainingDataMb: purchasedDataMb,
        billingTransactionId: transactionId,
      },
    });
  }

  const purchaseAlreadyContainsCarryForward =
    purchasedDataMb > 0 &&
    purchase.totalDataMb > purchasedDataMb;

  let carriedBalance = null;

  // Stripe Sandbox uses the mock provider, so preserve any
  // remaining finite-data balance when another pack is bought.
  // Live Telna balances remain provider-authoritative.
  if (
    isSandboxCheckout &&
    purchasedDataMb > 0 &&
    !purchaseAlreadyContainsCarryForward
  ) {
    const priorPack =
      await prisma.mobileDataPackPurchase.findFirst({
        where: {
          userId: Number(userId),
          id: {
            not: purchase.id,
          },
          expiresAt: {
            gt: purchasedAt,
          },
          remainingDataMb: {
            gt: 0,
          },
        },
        orderBy: {
          purchasedAt: 'desc',
        },
      });

    if (priorPack) {
      carriedBalance = {
        purchaseId: priorPack.id,
        totalDataMb: priorPack.totalDataMb,
        remainingDataMb:
          priorPack.remainingDataMb,
      };
    }
  }

  let subscriber = await getReusableSubscriberForUser(userId);

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
      testMode: isSandboxCheckout,
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
      testMode: isSandboxCheckout,
    });
  }

  const nextExpiresAt =
    providerPack?.expiresAt || fallbackExpiresAt;

  let nextTotalDataMb =
    purchaseAlreadyContainsCarryForward
      ? purchase.totalDataMb
      : typeof providerPack?.dataMb === 'number'
        ? providerPack.dataMb
        : purchasedDataMb;

  let nextRemainingDataMb =
    purchaseAlreadyContainsCarryForward
      ? purchase.remainingDataMb
      : nextTotalDataMb;

  if (carriedBalance) {
    nextTotalDataMb =
      carriedBalance.totalDataMb +
      purchasedDataMb;

    nextRemainingDataMb =
      carriedBalance.remainingDataMb +
      purchasedDataMb;
  }

  const nextProviderMeta = subscriber?.id
    ? {
        ...(subscriber.providerMeta || {}),
        stripeSessionId: session.id,
        stripePaymentIntentId: transactionId,
        product,
        addonKind: addonCfg.addonKind,
      }
    : null;

  if (nextProviderMeta && reserve) {
    nextProviderMeta.reserve = reserve;
  }

  if (nextProviderMeta && providerPack) {
    nextProviderMeta.providerPack =
      providerPack;
  }

  if (nextProviderMeta && carriedBalance) {
    nextProviderMeta.topUp = {
      previousPurchaseId:
        carriedBalance.purchaseId,
      carriedTotalDataMb:
        carriedBalance.totalDataMb,
      carriedRemainingDataMb:
        carriedBalance.remainingDataMb,
      creditedDataMb:
        purchasedDataMb,
      combinedTotalDataMb:
        nextTotalDataMb,
      combinedRemainingDataMb:
        nextRemainingDataMb,
      appliedAt:
        new Date().toISOString(),
      sandbox: true,
    };
  }

  await prisma.$transaction(async (tx) => {
    if (carriedBalance) {
      await tx.mobileDataPackPurchase.update({
        where: {
          id: carriedBalance.purchaseId,
        },
        data: {
          // The balance has been transferred into the
          // newest active purchase record.
          remainingDataMb: 0,
        },
      });
    }

    await tx.mobileDataPackPurchase.update({
      where: {
        id: purchase.id,
      },
      data: {
        expiresAt: nextExpiresAt,
        totalDataMb: nextTotalDataMb,
        remainingDataMb:
          nextRemainingDataMb,
        esimProfileId:
          providerProfileId ||
          purchase.esimProfileId ||
          null,
        iccid:
          providerPack?.iccid ||
          reserve?.iccid ||
          subscriber?.iccid ||
          purchase.iccid ||
          null,
        qrCodeSvg:
          providerPack?.qrCodeSvg ||
          purchase.qrCodeSvg ||
          null,
      },
    });

    if (subscriber?.id) {
      await tx.subscriber.update({
        where: {
          id: subscriber.id,
        },
        data: {
          purchaseId: purchase.id,
          providerProfileId:
            providerProfileId ||
            subscriber.providerProfileId ||
            null,
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
  });

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
            [
              'canceled',
              'unpaid',
              'incomplete_expired',
            ].includes(subscription.status)
          ) {
            await markSubscriptionCanceledOrPastDue(
              subscription,
              subscription.status
            );
          }
          break;
        }

        case 'customer.subscription.deleted': {
          const subscription =
            event.data.object;

          await markSubscriptionCanceledOrPastDue(
            subscription,
            'CANCELED'
          );

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