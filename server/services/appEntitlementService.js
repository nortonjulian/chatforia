import prisma from '../utils/prismaClient.js';

const PLAN_PRIORITY = Object.freeze({
  FREE: 0,
  PLUS: 1,
  PREMIUM: 2,
});

const PROVIDER_PRIORITY = Object.freeze({
  STRIPE: 4,
  APPLE: 3,
  GOOGLE_PLAY: 2,
  MANUAL: 1,
});

function normalizeUserId(userId) {
  const value = Number(userId);

  if (!Number.isInteger(value) || value <= 0) {
    const error = new Error('A valid user ID is required.');
    error.statusCode = 400;
    error.code = 'INVALID_USER_ID';
    throw error;
  }

  return value;
}

function expiryScore(value) {
  if (!value) {
    return Number.MAX_SAFE_INTEGER;
  }

  return value.getTime();
}

function chooseBestEntitlement(subscriptions) {
  return [...subscriptions].sort((left, right) => {
    const planDifference =
      (PLAN_PRIORITY[right.plan] ?? 0) -
      (PLAN_PRIORITY[left.plan] ?? 0);

    if (planDifference !== 0) {
      return planDifference;
    }

    const providerDifference =
      (PROVIDER_PRIORITY[right.provider] ?? 0) -
      (PROVIDER_PRIORITY[left.provider] ?? 0);

    if (providerDifference !== 0) {
      return providerDifference;
    }

    const expiryDifference =
      expiryScore(right.endsAt) -
      expiryScore(left.endsAt);

    if (expiryDifference !== 0) {
      return expiryDifference;
    }

    return (
      right.updatedAt.getTime() -
      left.updatedAt.getTime()
    );
  })[0] ?? null;
}

function projectedSubscriptionId(subscription) {
  if (!subscription) {
    return null;
  }

  if (
    subscription.provider === 'STRIPE' ||
    subscription.provider === 'APPLE'
  ) {
    return subscription.providerSubscriptionKey;
  }

  // Google purchase tokens and manual keys must remain
  // outside User.billingSubscriptionId.
  return null;
}

export async function getEffectiveAppEntitlement(
  userId,
  {
    db = prisma,
    now = new Date(),
  } = {}
) {
  const normalizedUserId = normalizeUserId(userId);

  const subscriptions =
    await db.appSubscription.findMany({
      where: {
        userId: normalizedUserId,
        grantsAccess: true,
        plan: {
          in: ['PLUS', 'PREMIUM'],
        },
        AND: [
          {
            OR: [
              { startsAt: null },
              { startsAt: { lte: now } },
            ],
          },
          {
            OR: [
              { endsAt: null },
              { endsAt: { gt: now } },
            ],
          },
        ],
      },
      select: {
        id: true,
        userId: true,
        provider: true,
        providerSubscriptionKey: true,
        productId: true,
        basePlanId: true,
        plan: true,
        status: true,
        grantsAccess: true,
        autoRenewEnabled: true,
        startsAt: true,
        endsAt: true,
        lastVerifiedAt: true,
        updatedAt: true,
      },
    });

  return chooseBestEntitlement(subscriptions);
}

export async function recomputeUserAppEntitlement(
  userId,
  {
    db = prisma,
    now = new Date(),
  } = {}
) {
  const normalizedUserId = normalizeUserId(userId);

  const user = await db.user.findUnique({
    where: {
      id: normalizedUserId,
    },
    select: {
      id: true,
      plan: true,
      subscriptionStatus: true,
      subscriptionEndsAt: true,
      billingProvider: true,
      billingSubscriptionId: true,
      firstPaidAt: true,
    },
  });

  if (!user) {
    const error = new Error('Chatforia user not found.');
    error.statusCode = 404;
    error.code = 'USER_NOT_FOUND';
    throw error;
  }

  const selected =
    await getEffectiveAppEntitlement(
      normalizedUserId,
      {
        db,
        now,
      }
    );

  const data = selected
    ? {
        plan: selected.plan,
        subscriptionStatus:
          String(selected.status || 'ACTIVE').toUpperCase(),
        subscriptionEndsAt: selected.endsAt,
        billingProvider: selected.provider,
        billingSubscriptionId:
          projectedSubscriptionId(selected),

        ...(
          !user.firstPaidAt &&
          selected.provider !== 'MANUAL'
            ? { firstPaidAt: now }
            : {}
        ),
      }
    : {
        plan: 'FREE',
        subscriptionStatus: 'INACTIVE',
        subscriptionEndsAt: null,
        billingProvider: null,
        billingSubscriptionId: null,
      };

  const updatedUser = await db.user.update({
    where: {
      id: normalizedUserId,
    },
    data,
    select: {
      id: true,
      plan: true,
      subscriptionStatus: true,
      subscriptionEndsAt: true,
      billingProvider: true,
      billingSubscriptionId: true,
      firstPaidAt: true,
    },
  });

  return {
    selectedEntitlement: selected,
    previousUser: user,
    user: updatedUser,
  };
}
