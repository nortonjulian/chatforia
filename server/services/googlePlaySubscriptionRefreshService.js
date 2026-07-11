import prisma from '../utils/prismaClient.js';

import {
  verifyAndApplyGooglePlaySubscription,
} from './googlePlayEntitlementService.js';

function createRefreshError(
  message,
  statusCode,
  code
) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  return error;
}

function normalizeUserId(userId) {
  if (
    userId === null ||
    userId === undefined ||
    userId === ''
  ) {
    return null;
  }

  const value = Number(userId);

  if (
    !Number.isInteger(value) ||
    value <= 0
  ) {
    throw createRefreshError(
      'A valid Chatforia user ID is required.',
      400,
      'INVALID_USER_ID'
    );
  }

  return value;
}

function normalizePurchaseToken(value) {
  const token =
    String(value || '').trim();

  if (!token) {
    throw createRefreshError(
      'A Google Play purchase token is required.',
      400,
      'PURCHASE_TOKEN_REQUIRED'
    );
  }

  return token;
}

function normalizeSource(value) {
  const source =
    String(value || 'DEVICE')
      .trim()
      .toUpperCase();

  if (
    ![
      'DEVICE',
      'RTDN',
      'RECONCILIATION',
    ].includes(source)
  ) {
    throw createRefreshError(
      'The Google Play refresh source is invalid.',
      400,
      'GOOGLE_PLAY_REFRESH_SOURCE_INVALID'
    );
  }

  return source;
}

function normalizeOptionalDate(value) {
  if (
    value === null ||
    value === undefined ||
    value === ''
  ) {
    return null;
  }

  const date =
    value instanceof Date
      ? value
      : new Date(value);

  if (Number.isNaN(date.getTime())) {
    throw createRefreshError(
      'The Google Play RTDN event time is invalid.',
      400,
      'GOOGLE_PLAY_RTDN_EVENT_TIME_INVALID'
    );
  }

  return date;
}

function normalizeNotificationType(value) {
  if (
    value === null ||
    value === undefined ||
    value === ''
  ) {
    return null;
  }

  const normalized = Number(value);

  if (
    !Number.isInteger(normalized) ||
    normalized <= 0
  ) {
    throw createRefreshError(
      'The Google Play RTDN notification type is invalid.',
      400,
      'GOOGLE_PLAY_RTDN_NOTIFICATION_TYPE_INVALID'
    );
  }

  return normalized;
}

async function resolveSubscriptionOwner(
  purchaseToken,
  {
    db,
    expectedUserId,
  }
) {
  const existing =
    await db.googlePlaySubscription.findUnique({
      where: {
        purchaseToken,
      },
      select: {
        id: true,
        userId: true,
      },
    });

  if (expectedUserId) {
    if (
      existing &&
      existing.userId !== expectedUserId
    ) {
      throw createRefreshError(
        'This Google Play purchase belongs to another Chatforia account.',
        409,
        'GOOGLE_PLAY_TOKEN_ALREADY_LINKED'
      );
    }

    return {
      userId: expectedUserId,
      existingSubscription: existing,
    };
  }

  if (!existing) {
    throw createRefreshError(
      'The Google Play purchase is not linked to a Chatforia account.',
      404,
      'GOOGLE_PLAY_SUBSCRIPTION_NOT_LINKED'
    );
  }

  return {
    userId: existing.userId,
    existingSubscription: existing,
  };
}

export async function refreshGooglePlaySubscription({
  purchaseToken,
  userId = null,
  source = 'DEVICE',
  rtdnEventTime = null,
  rtdnNotificationType = null,
  db = prisma,
}) {
  const normalizedToken =
    normalizePurchaseToken(purchaseToken);

  const normalizedUserId =
    normalizeUserId(userId);

  const normalizedSource =
    normalizeSource(source);

  if (
    normalizedSource === 'DEVICE' &&
    !normalizedUserId
  ) {
    throw createRefreshError(
      'An authenticated Chatforia user is required.',
      401,
      'UNAUTHORIZED'
    );
  }

  const normalizedRtdnEventTime =
    normalizeOptionalDate(rtdnEventTime);

  const normalizedNotificationType =
    normalizeNotificationType(
      rtdnNotificationType
    );

  if (
    normalizedSource === 'RTDN' &&
    !normalizedRtdnEventTime
  ) {
    throw createRefreshError(
      'An RTDN refresh requires its event time.',
      400,
      'GOOGLE_PLAY_RTDN_EVENT_TIME_REQUIRED'
    );
  }

  const {
    userId: resolvedUserId,
  } = await resolveSubscriptionOwner(
    normalizedToken,
    {
      db,
      expectedUserId:
        normalizedUserId,
    }
  );

  const result =
    await verifyAndApplyGooglePlaySubscription({
      userId: resolvedUserId,
      purchaseToken: normalizedToken,
    });

  if (normalizedSource === 'RTDN') {
    await db.googlePlaySubscription.update({
      where: {
        id: result.subscription.id,
      },
      data: {
        lastRtdnAt:
          normalizedRtdnEventTime,

        lastRtdnNotificationType:
          normalizedNotificationType,
      },
    });
  }

  return {
    ...result,
    refreshSource:
      normalizedSource,
  };
}
