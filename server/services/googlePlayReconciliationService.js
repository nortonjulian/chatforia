import {
  randomUUID,
} from 'node:crypto';

import prisma from '../utils/prismaClient.js';
import { ENV } from '../config/env.js';
import logger from '../utils/logger.js';

import {
  refreshGooglePlaySubscription,
} from './googlePlaySubscriptionRefreshService.js';

const DEFAULT_LEASE_MS =
  15 * 60 * 1000;

const RECENT_EXPIRY_WINDOW_MS =
  30 * 24 * 60 * 60 * 1000;

function positiveInteger(
  value,
  fallback,
  maximum = 10_000
) {
  const normalized = Number(value);

  if (
    !Number.isInteger(normalized) ||
    normalized <= 0
  ) {
    return fallback;
  }

  return Math.min(
    normalized,
    maximum
  );
}

function safeErrorCode(error) {
  return String(
    error?.code ??
    error?.response?.status ??
    error?.statusCode ??
    'GOOGLE_PLAY_RECONCILIATION_FAILED'
  ).slice(0, 100);
}

function safeErrorMessage(
  error,
  purchaseToken
) {
  let message =
    String(
      error?.message ||
      'Google Play reconciliation failed.'
    );

  if (purchaseToken) {
    message = message
      .split(purchaseToken)
      .join('[REDACTED]');
  }

  return message.slice(0, 500);
}

function buildCandidateWhere({
  now,
  staleBefore,
  recentExpiryCutoff,
}) {
  return {
    revokedAt: null,
    supersededAt: null,

    AND: [
      {
        OR: [
          {
            reconciliationLeaseUntil:
              null,
          },
          {
            reconciliationLeaseUntil: {
              lte: now,
            },
          },
        ],
      },

      {
        OR: [
          {
            lastVerifiedAt: null,
          },
          {
            lastVerifiedAt: {
              lte: staleBefore,
            },
          },
          {
            acknowledgementState:
              'ACKNOWLEDGEMENT_STATE_PENDING',

            accessGrantedSnapshot:
              true,

            OR: [
              {
                nextAcknowledgementAttemptAt:
                  null,
              },
              {
                nextAcknowledgementAttemptAt: {
                  lte: now,
                },
              },
            ],
          },
        ],
      },

      {
        OR: [
          {
            accessGrantedSnapshot:
              true,
          },
          {
            acknowledgementState:
              'ACKNOWLEDGEMENT_STATE_PENDING',
          },
          {
            expiryTime: null,
          },
          {
            expiryTime: {
              gte:
                recentExpiryCutoff,
            },
          },
        ],
      },
    ],
  };
}

async function releaseLease({
  db,
  subscriptionId,
  leaseId,
  data = {},
}) {
  return db.googlePlaySubscription.updateMany({
    where: {
      id: subscriptionId,
      reconciliationLeaseId:
        leaseId,
    },

    data: {
      ...data,

      reconciliationLeaseId:
        null,

      reconciliationLeaseUntil:
        null,
    },
  });
}

export async function runGooglePlayReconciliationBatch({
  db = prisma,

  refreshFn =
    refreshGooglePlaySubscription,

  clock = () => new Date(),

  batchSize =
    ENV.GOOGLE_PLAY_RECONCILIATION_BATCH_SIZE,

  staleMinutes =
    ENV.GOOGLE_PLAY_RECONCILIATION_STALE_MINUTES,

  leaseMs =
    DEFAULT_LEASE_MS,

  loggerInstance = logger,
} = {}) {
  const normalizedBatchSize =
    positiveInteger(
      batchSize,
      100,
      1_000
    );

  const normalizedStaleMinutes =
    positiveInteger(
      staleMinutes,
      360,
      525_600
    );

  const normalizedLeaseMs =
    positiveInteger(
      leaseMs,
      DEFAULT_LEASE_MS,
      60 * 60 * 1000
    );

  const startedAt = clock();

  const staleBefore =
    new Date(
      startedAt.getTime() -
      (
        normalizedStaleMinutes *
        60 * 1000
      )
    );

  const recentExpiryCutoff =
    new Date(
      startedAt.getTime() -
      RECENT_EXPIRY_WINDOW_MS
    );

  const candidates =
    await db.googlePlaySubscription.findMany({
      where:
        buildCandidateWhere({
          now: startedAt,
          staleBefore,
          recentExpiryCutoff,
        }),

      select: {
        id: true,
        purchaseToken: true,
      },

      orderBy: [
        {
          nextAcknowledgementAttemptAt:
            'asc',
        },
        {
          lastVerifiedAt:
            'asc',
        },
        {
          createdAt:
            'asc',
        },
      ],

      take:
        normalizedBatchSize,
    });

  const summary = {
    selected:
      candidates.length,

    claimed: 0,
    refreshed: 0,
    failed: 0,
    leaseSkipped: 0,
    leaseReleaseFailed: 0,
  };

  for (const candidate of candidates) {
    const leaseId =
      randomUUID();

    const claimTime =
      clock();

    const leaseUntil =
      new Date(
        claimTime.getTime() +
        normalizedLeaseMs
      );

    let claim;

    try {
      claim =
        await db
          .googlePlaySubscription
          .updateMany({
            where: {
              id: candidate.id,

              OR: [
                {
                  reconciliationLeaseUntil:
                    null,
                },
                {
                  reconciliationLeaseUntil: {
                    lte: claimTime,
                  },
                },
              ],
            },

            data: {
              reconciliationLeaseId:
                leaseId,

              reconciliationLeaseUntil:
                leaseUntil,
            },
          });
    } catch (error) {
      summary.failed += 1;

      loggerInstance.error(
        {
          subscriptionId:
            candidate.id,

          code:
            safeErrorCode(error),

          message:
            safeErrorMessage(
              error,
              candidate.purchaseToken
            ),
        },
        'Google Play reconciliation lease claim failed'
      );

      continue;
    }

    if (claim.count !== 1) {
      summary.leaseSkipped += 1;
      continue;
    }

    summary.claimed += 1;

    try {
      await refreshFn({
        purchaseToken:
          candidate.purchaseToken,

        source:
          'RECONCILIATION',

        db,
      });

      summary.refreshed += 1;

      try {
        await releaseLease({
          db,
          subscriptionId:
            candidate.id,
          leaseId,
        });
      } catch (error) {
        summary.leaseReleaseFailed += 1;

        loggerInstance.warn(
          {
            subscriptionId:
              candidate.id,

            code:
              safeErrorCode(error),

            message:
              safeErrorMessage(
                error,
                candidate.purchaseToken
              ),
          },
          'Google Play reconciliation lease release failed'
        );
      }
    } catch (error) {
      summary.failed += 1;

      const errorCode =
        safeErrorCode(error);

      const errorMessage =
        safeErrorMessage(
          error,
          candidate.purchaseToken
        );

      try {
        await releaseLease({
          db,
          subscriptionId:
            candidate.id,
          leaseId,

          data: {
            lastVerificationErrorCode:
              errorCode,

            lastVerificationErrorMessage:
              errorMessage,
          },
        });
      } catch (persistenceError) {
        summary.leaseReleaseFailed += 1;

        loggerInstance.error(
          {
            subscriptionId:
              candidate.id,

            code:
              safeErrorCode(
                persistenceError
              ),

            message:
              safeErrorMessage(
                persistenceError,
                candidate.purchaseToken
              ),
          },
          'Google Play reconciliation failure persistence failed'
        );
      }

      loggerInstance.warn(
        {
          subscriptionId:
            candidate.id,

          code:
            errorCode,

          message:
            errorMessage,
        },
        'Google Play subscription reconciliation failed'
      );
    }
  }

  return summary;
}
