import prisma from '../utils/prismaClient.js';

import {
  getGooglePlaySubscription,
  normalizeGooglePlaySubscription,
  acknowledgeGooglePlaySubscription,
} from './googlePlayBillingService.js';

import {
  recomputeUserAppEntitlement,
} from './appEntitlementService.js';

function createServiceError(message, statusCode, code) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  return error;
}

function validateVerifiedSubscription(verified) {
  if (!verified?.productId) {
    throw createServiceError(
      'Google Play did not return a valid subscription product.',
      400,
      'GOOGLE_PLAY_PRODUCT_MISSING'
    );
  }

  if (
    !['PLUS', 'PREMIUM'].includes(
      String(verified.entitlementPlan || '')
    )
  ) {
    throw createServiceError(
      'This Google Play product does not map to a supported Chatforia plan.',
      400,
      'GOOGLE_PLAY_PRODUCT_UNSUPPORTED'
    );
  }
}

function buildGoogleSubscriptionCreateData(
  userId,
  verified
) {
  return {
    userId,
    purchaseToken: verified.purchaseToken,
    ...buildGoogleSubscriptionUpdateData(verified),
  };
}

function buildGoogleSubscriptionUpdateData(verified) {
  return {
    packageName: verified.packageName,
    productId: verified.productId,
    basePlanId: verified.basePlanId,

    linkedPurchaseToken:
      verified.linkedPurchaseToken,

    latestOrderId:
      verified.latestOrderId,

    entitlementPlan:
      verified.entitlementPlan,

    subscriptionState:
      verified.subscriptionState,

    acknowledgementState:
      verified.acknowledgementState,

    autoRenewEnabled:
      verified.autoRenewEnabled,

    startTime:
      verified.startTime,

    expiryTime:
      verified.expiryTime,

    regionCode:
      verified.regionCode,

    isTestPurchase:
      verified.isTestPurchase,

    rawResponse:
      verified.rawResponse,
  };
}

function googleAppSubscriptionKey(
  googlePlaySubscriptionId
) {
  // Use Chatforia's internal Google subscription record ID.
  // Do not duplicate the raw purchase token in AppSubscription.
  return `google-play:${googlePlaySubscriptionId}`;
}

function canonicalGoogleSubscriptionStatus(state) {
  switch (String(state || '').toUpperCase()) {
    case 'SUBSCRIPTION_STATE_ACTIVE':
      return 'ACTIVE';

    case 'SUBSCRIPTION_STATE_IN_GRACE_PERIOD':
      return 'IN_GRACE_PERIOD';

    case 'SUBSCRIPTION_STATE_CANCELED':
      return 'CANCELED';

    case 'SUBSCRIPTION_STATE_ON_HOLD':
      return 'ON_HOLD';

    case 'SUBSCRIPTION_STATE_PAUSED':
      return 'PAUSED';

    case 'SUBSCRIPTION_STATE_EXPIRED':
      return 'EXPIRED';

    case 'SUBSCRIPTION_STATE_PENDING':
      return 'PENDING';

    case 'SUBSCRIPTION_STATE_PENDING_PURCHASE_CANCELED':
      return 'CANCELED';

    default:
      return 'UNKNOWN';
  }
}

function buildAppSubscriptionData(
  verified,
  now
) {
  return {
    customerReference: null,

    productId:
      verified.productId,

    basePlanId:
      verified.basePlanId,

    plan:
      verified.entitlementPlan,

    status:
      canonicalGoogleSubscriptionStatus(
        verified.subscriptionState
      ),

    grantsAccess:
      Boolean(verified.grantsAccess),

    autoRenewEnabled:
      verified.autoRenewEnabled,

    startsAt:
      verified.startTime,

    endsAt:
      verified.expiryTime,

    lastVerifiedAt:
      now,

    // Store only a safe provider summary here.
    // The complete Google response stays in
    // GooglePlaySubscription.rawResponse.
    rawResponse: {
      source: 'google-play',
      subscriptionState:
        verified.subscriptionState ?? null,
      latestOrderId:
        verified.latestOrderId ?? null,
      regionCode:
        verified.regionCode ?? null,
      isTestPurchase:
        Boolean(verified.isTestPurchase),
      acknowledgementState:
        verified.acknowledgementState ?? null,
    },
  };
}

async function assertPurchaseOwnership(
  tx,
  userId,
  verified
) {
  const existing =
    await tx.googlePlaySubscription.findUnique({
      where: {
        purchaseToken:
          verified.purchaseToken,
      },
      select: {
        id: true,
        userId: true,
      },
    });

  if (existing && existing.userId !== userId) {
    throw createServiceError(
      'This Google Play purchase is already linked to another Chatforia account.',
      409,
      'GOOGLE_PLAY_TOKEN_ALREADY_LINKED'
    );
  }

  if (!verified.linkedPurchaseToken) {
    return null;
  }

  const linked =
    await tx.googlePlaySubscription.findUnique({
      where: {
        purchaseToken:
          verified.linkedPurchaseToken,
      },
      select: {
        id: true,
        userId: true,
      },
    });

  if (linked && linked.userId !== userId) {
    throw createServiceError(
      'The linked Google Play subscription belongs to another Chatforia account.',
      409,
      'GOOGLE_PLAY_LINKED_TOKEN_MISMATCH'
    );
  }

  return linked;
}

async function disableSupersededSubscription(
  tx,
  linkedSubscription,
  now
) {
  if (!linkedSubscription) {
    return;
  }

  await tx.appSubscription.updateMany({
    where: {
      provider: 'GOOGLE_PLAY',
      providerSubscriptionKey:
        googleAppSubscriptionKey(
          linkedSubscription.id
        ),
    },
    data: {
      status: 'SUPERSEDED',
      grantsAccess: false,
      endsAt: now,
      lastVerifiedAt: now,
      rawResponse: {
        source: 'google-play',
        reason: 'linked-purchase-replaced',
      },
    },
  });
}

async function attemptAcknowledgement({
  verified,
  googleSubscriptionId,
  userId,
}) {
  const alreadyAcknowledged =
    verified.acknowledgementState ===
    'ACKNOWLEDGEMENT_STATE_ACKNOWLEDGED';

  if (alreadyAcknowledged) {
    return {
      acknowledged: true,
      acknowledgementPending: false,
    };
  }

  const acknowledgementPending =
    verified.acknowledgementState ===
    'ACKNOWLEDGEMENT_STATE_PENDING';

  if (
    !verified.grantsAccess ||
    !acknowledgementPending
  ) {
    return {
      acknowledged: false,
      acknowledgementPending,
    };
  }

  try {
    await acknowledgeGooglePlaySubscription({
      purchaseToken:
        verified.purchaseToken,

      productId:
        verified.productId,
    });

    try {
      await prisma.googlePlaySubscription.update({
        where: {
          id: googleSubscriptionId,
        },
        data: {
          acknowledgementState:
            'ACKNOWLEDGEMENT_STATE_ACKNOWLEDGED',
        },
      });
    } catch (persistenceError) {
      // Google acknowledgement succeeded. A later reconciliation
      // can correct the local acknowledgement state.
      console.error(
        '[googlePlayEntitlement] acknowledgement persistence failed',
        {
          userId,
          googleSubscriptionId,
          code:
            persistenceError?.code ?? null,
          message:
            persistenceError?.message ?? null,
        }
      );
    }

    return {
      acknowledged: true,
      acknowledgementPending: false,
    };
  } catch (error) {
    // Access was already verified and stored. Do not report the
    // purchase as failed merely because acknowledgement needs retry.
    console.error(
      '[googlePlayEntitlement] acknowledgement failed',
      {
        userId,
        googleSubscriptionId,
        productId:
          verified.productId,
        code:
          error?.code ?? null,
        status:
          error?.response?.status ??
          error?.statusCode ??
          null,
        message:
          error?.message ?? null,
      }
    );

    return {
      acknowledged: false,
      acknowledgementPending: true,
    };
  }
}

export async function verifyAndApplyGooglePlaySubscription({
  userId,
  purchaseToken,
}) {
  const normalizedUserId = Number(userId);
  const normalizedToken =
    String(purchaseToken || '').trim();

  if (
    !Number.isInteger(normalizedUserId) ||
    normalizedUserId <= 0
  ) {
    throw createServiceError(
      'A valid authenticated user is required.',
      401,
      'UNAUTHORIZED'
    );
  }

  if (!normalizedToken) {
    throw createServiceError(
      'A Google Play purchase token is required.',
      400,
      'PURCHASE_TOKEN_REQUIRED'
    );
  }

  const googleSubscription =
    await getGooglePlaySubscription(
      normalizedToken
    );

  const verified =
    normalizeGooglePlaySubscription(
      normalizedToken,
      googleSubscription
    );

  validateVerifiedSubscription(verified);

  const now = new Date();

  const transactionResult =
    await prisma.$transaction(async (tx) => {
      const user =
        await tx.user.findUnique({
          where: {
            id: normalizedUserId,
          },
          select: {
            id: true,
          },
        });

      if (!user) {
        throw createServiceError(
          'Chatforia user not found.',
          404,
          'USER_NOT_FOUND'
        );
      }

      const linkedSubscription =
        await assertPurchaseOwnership(
          tx,
          normalizedUserId,
          verified
        );

      const googlePlaySubscription =
        await tx.googlePlaySubscription.upsert({
          where: {
            purchaseToken:
              verified.purchaseToken,
          },

          create:
            buildGoogleSubscriptionCreateData(
              normalizedUserId,
              verified
            ),

          // Ownership fields are deliberately excluded.
          update:
            buildGoogleSubscriptionUpdateData(
              verified
            ),
        });

      // Protect against a concurrent token-linking race.
      if (
        googlePlaySubscription.userId !==
        normalizedUserId
      ) {
        throw createServiceError(
          'This Google Play purchase is already linked to another Chatforia account.',
          409,
          'GOOGLE_PLAY_TOKEN_ALREADY_LINKED'
        );
      }

      if (
        linkedSubscription &&
        linkedSubscription.id !==
          googlePlaySubscription.id
      ) {
        await disableSupersededSubscription(
          tx,
          linkedSubscription,
          now
        );
      }

      const providerSubscriptionKey =
        googleAppSubscriptionKey(
          googlePlaySubscription.id
        );

      const appSubscriptionData =
        buildAppSubscriptionData(
          verified,
          now
        );

      const appSubscription =
        await tx.appSubscription.upsert({
          where: {
            provider_providerSubscriptionKey: {
              provider:
                'GOOGLE_PLAY',

              providerSubscriptionKey,
            },
          },

          create: {
            userId:
              normalizedUserId,

            provider:
              'GOOGLE_PLAY',

            providerSubscriptionKey,

            ...appSubscriptionData,
          },

          // Ownership fields are deliberately excluded.
          update:
            appSubscriptionData,
        });

      if (
        appSubscription.userId !==
        normalizedUserId
      ) {
        throw createServiceError(
          'This Google Play entitlement is already linked to another Chatforia account.',
          409,
          'GOOGLE_PLAY_ENTITLEMENT_ALREADY_LINKED'
        );
      }

      const entitlementResult =
        await recomputeUserAppEntitlement(
          normalizedUserId,
          {
            db: tx,
            now,
          }
        );

      return {
        googlePlaySubscription,
        appSubscription,
        entitlementResult,
      };
    });

  const acknowledgement =
    await attemptAcknowledgement({
      verified,
      googleSubscriptionId:
        transactionResult
          .googlePlaySubscription
          .id,

      userId:
        normalizedUserId,
    });

  return {
    verified,

    acknowledged:
      acknowledgement.acknowledged,

    acknowledgementPending:
      acknowledgement.acknowledgementPending,

    subscription:
      transactionResult
        .googlePlaySubscription,

    appSubscription:
      transactionResult
        .appSubscription,

    user:
      transactionResult
        .entitlementResult
        .user,
  };
}
