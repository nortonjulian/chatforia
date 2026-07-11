import Stripe from 'stripe';
import prisma from '../utils/prismaClient.js';

const APPLY = process.argv.includes('--apply');

function dateFromUnix(value) {
  const seconds = Number(value);

  if (!Number.isFinite(seconds) || seconds <= 0) {
    return null;
  }

  return new Date(seconds * 1000);
}

function planFromPriceId(priceId) {
  const id = String(priceId || '');

  if (id === String(process.env.STRIPE_PRICE_PLUS_MONTHLY)) {
    return {
      plan: 'PLUS',
      configuredPriceName: 'STRIPE_PRICE_PLUS_MONTHLY',
    };
  }

  if (id === String(process.env.STRIPE_PRICE_PREMIUM_MONTHLY)) {
    return {
      plan: 'PREMIUM',
      configuredPriceName: 'STRIPE_PRICE_PREMIUM_MONTHLY',
    };
  }

  if (id === String(process.env.STRIPE_PRICE_PREMIUM_ANNUAL)) {
    return {
      plan: 'PREMIUM',
      configuredPriceName: 'STRIPE_PRICE_PREMIUM_ANNUAL',
    };
  }

  return null;
}

function statusGrantsAccess(status, endsAt) {
  const activeStatus = ['active', 'trialing'].includes(
    String(status || '').toLowerCase()
  );

  const unexpired =
    !endsAt || endsAt.getTime() > Date.now();

  return activeStatus && unexpired;
}

async function backfillStripeSubscriptions(stripe) {
  const users = await prisma.user.findMany({
    where: {
      billingProvider: 'STRIPE',
      billingSubscriptionId: {
        not: null,
      },
    },
    select: {
      id: true,
      billingCustomerId: true,
      billingSubscriptionId: true,
    },
  });

  const planned = [];

  for (const user of users) {
    const subscription =
      await stripe.subscriptions.retrieve(
        user.billingSubscriptionId
      );

    const item = subscription.items?.data?.[0] ?? null;
    const priceId = item?.price?.id ?? null;
    const mapping = planFromPriceId(priceId);

    if (!mapping) {
      throw new Error(
        `Unable to map Stripe price for user ${user.id}.`
      );
    }

    const startsAt =
      dateFromUnix(subscription.start_date);

    const endsAt =
      dateFromUnix(
        item?.current_period_end ??
        subscription.current_period_end
      );

    const status = String(
      subscription.status || 'unknown'
    ).toUpperCase();

    const grantsAccess = statusGrantsAccess(
      subscription.status,
      endsAt
    );

    const data = {
      providerSubscriptionKey:
        String(subscription.id),

      customerReference:
        subscription.customer
          ? String(subscription.customer)
          : user.billingCustomerId,

      productId: String(priceId),
      basePlanId: null,
      plan: mapping.plan,
      status,
      grantsAccess,

      autoRenewEnabled:
        !Boolean(subscription.cancel_at_period_end),

      startsAt,
      endsAt,
      lastVerifiedAt: new Date(),

      rawResponse: {
        source: 'legacy-backfill',
        livemode: Boolean(subscription.livemode),
        cancelAtPeriodEnd:
          Boolean(subscription.cancel_at_period_end),
        configuredPriceName:
          mapping.configuredPriceName,
      },
    };

    planned.push({
      userId: user.id,
      provider: 'STRIPE',
      plan: mapping.plan,
      status,
      grantsAccess,
      endsAt: endsAt?.toISOString() ?? null,
      mode: subscription.livemode ? 'LIVE' : 'TEST',
      configuredPriceName:
        mapping.configuredPriceName,
    });

    if (APPLY) {
      await prisma.appSubscription.upsert({
        where: {
          provider_providerSubscriptionKey: {
            provider: 'STRIPE',
            providerSubscriptionKey:
              String(subscription.id),
          },
        },
        create: {
          userId: user.id,
          provider: 'STRIPE',
          ...data,
        },
        update: data,
      });
    }
  }

  return planned;
}

async function backfillManualPremium() {
  const user = await prisma.user.findUnique({
    where: {
      id: 24,
    },
    select: {
      id: true,
      plan: true,
      billingProvider: true,
      billingSubscriptionId: true,
      deletedAt: true,
    },
  });

  if (!user) {
    throw new Error('Manual Premium user 24 was not found.');
  }

  if (
    user.deletedAt ||
    user.plan !== 'PREMIUM' ||
    user.billingProvider ||
    user.billingSubscriptionId
  ) {
    throw new Error(
      'User 24 no longer matches the expected manual Premium state.'
    );
  }

  const providerSubscriptionKey =
    `manual:user:${user.id}:premium`;

  const data = {
    customerReference: null,
    productId: 'manual_premium',
    basePlanId: null,
    plan: 'PREMIUM',
    status: 'ACTIVE',
    grantsAccess: true,
    autoRenewEnabled: null,
    startsAt: null,
    endsAt: null,
    lastVerifiedAt: new Date(),

    rawResponse: {
      source: 'legacy-manual-premium-backfill',
    },
  };

  if (APPLY) {
    await prisma.appSubscription.upsert({
      where: {
        provider_providerSubscriptionKey: {
          provider: 'MANUAL',
          providerSubscriptionKey,
        },
      },
      create: {
        userId: user.id,
        provider: 'MANUAL',
        providerSubscriptionKey,
        ...data,
      },
      update: data,
    });
  }

  return {
    userId: user.id,
    provider: 'MANUAL',
    plan: 'PREMIUM',
    status: 'ACTIVE',
    grantsAccess: true,
    endsAt: null,
  };
}

async function main() {
  if (!process.env.STRIPE_SECRET_KEY) {
    throw new Error('STRIPE_SECRET_KEY is not configured.');
  }

  const stripe = new Stripe(
    process.env.STRIPE_SECRET_KEY
  );

  const stripeSubscriptions =
    await backfillStripeSubscriptions(stripe);

  const manualSubscription =
    await backfillManualPremium();

  console.log(JSON.stringify({
    mode: APPLY ? 'APPLY' : 'DRY_RUN',
    stripeSubscriptions,
    manualSubscription,
  }, null, 2));
}

try {
  await main();
} finally {
  await prisma.$disconnect();
}
