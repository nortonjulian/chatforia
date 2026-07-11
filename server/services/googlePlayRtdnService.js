import prisma from '../utils/prismaClient.js';

import {
  parseGooglePlayRtdnPush,
} from './googlePlayRtdnParser.js';

import {
  refreshGooglePlaySubscription,
} from './googlePlaySubscriptionRefreshService.js';

const TERMINAL_EVENT_STATUSES = new Set([
  'PROCESSED',
  'IGNORED',
  'UNMATCHED',
  'FAILED_PERMANENT',
]);

const PROCESSING_STALE_MS =
  10 * 60 * 1000;

const RETRYABLE_ERROR_CODES = new Set([
  'ETIMEDOUT',
  'ECONNRESET',
  'ECONNREFUSED',
  'EAI_AGAIN',
  'ENETUNREACH',
  'EHOSTUNREACH',
  'UND_ERR_CONNECT_TIMEOUT',
]);

function createServiceError(
  message,
  statusCode,
  code
) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  return error;
}

function boundedString(value, maxLength) {
  const normalized =
    String(value ?? '').trim();

  return normalized
    ? normalized.slice(0, maxLength)
    : null;
}

function safeErrorMessage(
  error,
  secret = null
) {
  let message =
    boundedString(
      error?.message ||
        'Google Play RTDN processing failed.',
      500
    ) ||
    'Google Play RTDN processing failed.';

  if (secret) {
    message = message
      .split(secret)
      .join('[REDACTED]');
  }

  return message;
}

function safeErrorCode(error) {
  return (
    boundedString(
      error?.code ??
        error?.response?.status ??
        error?.statusCode ??
        'GOOGLE_PLAY_RTDN_PROCESSING_FAILED',
      100
    ) ||
    'GOOGLE_PLAY_RTDN_PROCESSING_FAILED'
  );
}

function errorStatus(error) {
  const value = Number(
    error?.response?.status ??
      error?.statusCode
  );

  return Number.isInteger(value)
    ? value
    : null;
}

function isRetryableError(error) {
  const status = errorStatus(error);

  if (status === 408 || status === 429) {
    return true;
  }

  if (status && status >= 500) {
    return true;
  }

  return RETRYABLE_ERROR_CODES.has(
    String(error?.code || '').toUpperCase()
  );
}

function isUniqueConstraintError(error) {
  return error?.code === 'P2002';
}

function eventCreateData(parsed) {
  return {
    pubsubMessageId:
      parsed.pubsubMessageId,

    packageName:
      parsed.packageName,

    eventKind:
      parsed.eventKind,

    notificationVersion:
      parsed.notificationVersion ??
      parsed.developerNotificationVersion ??
      null,

    notificationType:
      parsed.notificationType,

    purchaseTokenHash:
      parsed.purchaseTokenHash,

    eventTime:
      parsed.eventTime,

    publishTime:
      parsed.publishTime,

    status: 'PROCESSING',
    attempts: 1,
  };
}

async function claimRtdnEvent(
  parsed,
  db
) {
  try {
    const event =
      await db.googlePlayRtdnEvent.create({
        data: eventCreateData(parsed),
      });

    return {
      event,
      duplicate: false,
      claimed: true,
    };
  } catch (error) {
    if (!isUniqueConstraintError(error)) {
      throw error;
    }
  }

  const existing =
    await db.googlePlayRtdnEvent.findUnique({
      where: {
        pubsubMessageId:
          parsed.pubsubMessageId,
      },
    });

  if (!existing) {
    throw createServiceError(
      'The duplicate RTDN event could not be resolved.',
      503,
      'GOOGLE_PLAY_RTDN_DEDUPE_LOOKUP_FAILED'
    );
  }

  if (
    TERMINAL_EVENT_STATUSES.has(
      existing.status
    )
  ) {
    return {
      event: existing,
      duplicate: true,
      claimed: false,
    };
  }

  const staleBefore =
    new Date(
      Date.now() - PROCESSING_STALE_MS
    );

  let retryClaimWhere = null;

  if (
    ['RECEIVED', 'FAILED_RETRYABLE'].includes(
      existing.status
    )
  ) {
    retryClaimWhere = {
      status: {
        in: [
          'RECEIVED',
          'FAILED_RETRYABLE',
        ],
      },
    };
  } else if (
    existing.status === 'PROCESSING' &&
    existing.updatedAt &&
    new Date(existing.updatedAt) <= staleBefore
  ) {
    retryClaimWhere = {
      status: 'PROCESSING',
      updatedAt: {
        lte: staleBefore,
      },
    };
  }

  if (retryClaimWhere) {
    const claimed =
      await db.googlePlayRtdnEvent.updateMany({
        where: {
          id: existing.id,
          ...retryClaimWhere,
        },
        data: {
          status: 'PROCESSING',

          attempts: {
            increment: 1,
          },

          lastErrorCode: null,
          lastErrorMessage: null,
          processedAt: null,
        },
      });

    if (claimed.count === 1) {
      const refreshedEvent =
        await db.googlePlayRtdnEvent.findUnique({
          where: {
            id: existing.id,
          },
        });

      if (!refreshedEvent) {
        throw createServiceError(
          'The claimed RTDN event could not be loaded.',
          503,
          'GOOGLE_PLAY_RTDN_CLAIM_LOOKUP_FAILED'
        );
      }

      return {
        event: refreshedEvent,
        duplicate: true,
        claimed: true,
      };
    }
  }

  throw createServiceError(
    'This Google Play RTDN event is already being processed.',
    503,
    'GOOGLE_PLAY_RTDN_EVENT_IN_PROGRESS'
  );
}

async function finishEvent(
  db,
  eventId,
  data
) {
  return db.googlePlayRtdnEvent.update({
    where: {
      id: eventId,
    },
    data,
  });
}

function terminalDuplicateResult(event) {
  return {
    acknowledged: true,
    duplicate: true,
    status: event.status,
    eventId: event.id,
    googlePlaySubscriptionId:
      event.googlePlaySubscriptionId ??
      null,
  };
}

function isSubscriptionEntitlementEvent(
  parsed
) {
  if (parsed.eventKind === 'SUBSCRIPTION') {
    return true;
  }

  return (
    parsed.eventKind === 'VOIDED_PURCHASE' &&
    parsed.voidedProductType === 1
  );
}

export async function processGooglePlayRtdnPush(
  body,
  {
    db = prisma,
    parseFn =
      parseGooglePlayRtdnPush,
    refreshFn =
      refreshGooglePlaySubscription,
  } = {}
) {
  const parsed = parseFn(body);

  const claim =
    await claimRtdnEvent(
      parsed,
      db
    );

  if (!claim.claimed) {
    return terminalDuplicateResult(
      claim.event
    );
  }

  const eventId = claim.event.id;
  const now = new Date();

  if (
    !isSubscriptionEntitlementEvent(parsed)
  ) {
    await finishEvent(
      db,
      eventId,
      {
        status: 'IGNORED',
        processedAt: now,
        lastErrorCode: null,
        lastErrorMessage: null,
      }
    );

    return {
      acknowledged: true,
      duplicate: claim.duplicate,
      status: 'IGNORED',
      eventId,
      googlePlaySubscriptionId: null,
    };
  }

  try {
    const refreshResult =
      await refreshFn({
        purchaseToken:
          parsed.purchaseToken,

        source: 'RTDN',

        rtdnEventTime:
          parsed.eventTime,

        rtdnNotificationType:
          parsed.notificationType,

        db,
      });

    const googlePlaySubscriptionId =
      refreshResult
        ?.subscription
        ?.id ?? null;

    await finishEvent(
      db,
      eventId,
      {
        status: 'PROCESSED',

        googlePlaySubscriptionId,

        processedAt: now,

        lastErrorCode: null,
        lastErrorMessage: null,
      }
    );

    return {
      acknowledged: true,
      duplicate: claim.duplicate,
      status: 'PROCESSED',
      eventId,
      googlePlaySubscriptionId,
      refreshResult,
    };
  } catch (error) {
    const code =
      safeErrorCode(error);

    const message =
      safeErrorMessage(
        error,
        parsed.purchaseToken
      );

    if (
      error?.code ===
      'GOOGLE_PLAY_SUBSCRIPTION_NOT_LINKED'
    ) {
      await finishEvent(
        db,
        eventId,
        {
          status: 'UNMATCHED',

          processedAt: now,

          lastErrorCode: code,
          lastErrorMessage: message,
        }
      );

      return {
        acknowledged: true,
        duplicate: claim.duplicate,
        status: 'UNMATCHED',
        eventId,
        googlePlaySubscriptionId: null,
      };
    }

    if (isRetryableError(error)) {
      await finishEvent(
        db,
        eventId,
        {
          status: 'FAILED_RETRYABLE',

          processedAt: null,

          lastErrorCode: code,
          lastErrorMessage: message,
        }
      );

      throw createServiceError(
        'Google Play RTDN processing temporarily failed.',
        503,
        'GOOGLE_PLAY_RTDN_RETRY_REQUIRED'
      );
    }

    await finishEvent(
      db,
      eventId,
      {
        status: 'FAILED_PERMANENT',

        processedAt: now,

        lastErrorCode: code,
        lastErrorMessage: message,
      }
    );

    return {
      acknowledged: true,
      duplicate: claim.duplicate,
      status: 'FAILED_PERMANENT',
      eventId,
      googlePlaySubscriptionId: null,
    };
  }
}
