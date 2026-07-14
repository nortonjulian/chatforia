/**
 * @jest-environment node
 */
import { jest } from '@jest/globals';

import {
  runGooglePlayReconciliationBatch,
} from '../services/googlePlayReconciliationService.js';

const fixedNow =
  new Date(
    '2026-07-11T20:00:00.000Z'
  );

function buildDb(candidates = []) {
  return {
    googlePlaySubscription: {
      findMany:
        jest.fn().mockResolvedValue(
          candidates
        ),

      updateMany:
        jest.fn(),
    },
  };
}

function buildLogger() {
  return {
    error: jest.fn(),
    warn: jest.fn(),
    info: jest.fn(),
  };
}

describe(
  'runGooglePlayReconciliationBatch',
  () => {
    test(
      'claims, refreshes, and releases a subscription',
      async () => {
        const db = buildDb([
          {
            id: 'google-sub-1',
            purchaseToken:
              'secret-token-1',
          },
        ]);

        db.googlePlaySubscription
          .updateMany
          .mockResolvedValueOnce({
            count: 1,
          })
          .mockResolvedValueOnce({
            count: 1,
          });

        const refreshFn =
          jest.fn().mockResolvedValue({
            subscription: {
              id: 'google-sub-1',
            },
          });

        const summary =
          await runGooglePlayReconciliationBatch({
            db,
            refreshFn,
            clock: () => fixedNow,
            batchSize: 25,
            staleMinutes: 360,
            leaseMs:
              15 * 60 * 1000,
            loggerInstance:
              buildLogger(),
          });

        expect(
          db.googlePlaySubscription
            .findMany
        ).toHaveBeenCalledWith(
          expect.objectContaining({
            take: 25,

            select: {
              id: true,
              purchaseToken: true,
            },
          })
        );

        const candidateQuery =
          db.googlePlaySubscription
            .findMany
            .mock.calls[0][0];

        expect(
          candidateQuery.where
        ).toEqual(
          expect.objectContaining({
            revokedAt: null,
            supersededAt: null,
          })
        );

        expect(
          refreshFn
        ).toHaveBeenCalledWith({
          purchaseToken:
            'secret-token-1',

          source:
            'RECONCILIATION',

          db,
        });

        expect(
          db.googlePlaySubscription
            .updateMany
        ).toHaveBeenNthCalledWith(
          2,
          {
            where: {
              id: 'google-sub-1',

              reconciliationLeaseId:
                expect.any(String),
            },

            data: {
              reconciliationLeaseId:
                null,

              reconciliationLeaseUntil:
                null,
            },
          }
        );

        expect(summary).toEqual({
          selected: 1,
          claimed: 1,
          refreshed: 1,
          failed: 0,
          leaseSkipped: 0,
          leaseReleaseFailed: 0,
        });
      }
    );

    test(
      'skips a candidate claimed by another worker',
      async () => {
        const db = buildDb([
          {
            id: 'google-sub-1',
            purchaseToken:
              'secret-token-1',
          },
        ]);

        db.googlePlaySubscription
          .updateMany
          .mockResolvedValue({
            count: 0,
          });

        const refreshFn = jest.fn();

        const summary =
          await runGooglePlayReconciliationBatch({
            db,
            refreshFn,
            clock: () => fixedNow,
            loggerInstance:
              buildLogger(),
          });

        expect(refreshFn)
          .not.toHaveBeenCalled();

        expect(summary).toEqual({
          selected: 1,
          claimed: 0,
          refreshed: 0,
          failed: 0,
          leaseSkipped: 1,
          leaseReleaseFailed: 0,
        });
      }
    );

    test(
      'persists a redacted verification failure and releases the lease',
      async () => {
        const token =
          'secret-purchase-token';

        const db = buildDb([
          {
            id: 'google-sub-1',
            purchaseToken: token,
          },
        ]);

        db.googlePlaySubscription
          .updateMany
          .mockResolvedValueOnce({
            count: 1,
          })
          .mockResolvedValueOnce({
            count: 1,
          });

        const refreshFn =
          jest.fn().mockRejectedValue(
            Object.assign(
              new Error(
                `Google rejected ${token}`
              ),
              {
                code: 'ETIMEDOUT',
              }
            )
          );

        const loggerInstance =
          buildLogger();

        const summary =
          await runGooglePlayReconciliationBatch({
            db,
            refreshFn,
            clock: () => fixedNow,
            loggerInstance,
          });

        const failurePersistence =
          db.googlePlaySubscription
            .updateMany
            .mock.calls[1][0];

        expect(
          failurePersistence.data
            .lastVerificationErrorCode
        ).toBe('ETIMEDOUT');

        expect(
          failurePersistence.data
            .lastVerificationErrorMessage
        ).toContain('[REDACTED]');

        expect(
          failurePersistence.data
            .lastVerificationErrorMessage
        ).not.toContain(token);

        expect(
          failurePersistence.data
            .reconciliationLeaseId
        ).toBeNull();

        expect(
          failurePersistence.data
            .reconciliationLeaseUntil
        ).toBeNull();

        expect(
          JSON.stringify(
            loggerInstance.warn.mock.calls
          )
        ).not.toContain(token);

        expect(summary).toEqual({
          selected: 1,
          claimed: 1,
          refreshed: 0,
          failed: 1,
          leaseSkipped: 0,
          leaseReleaseFailed: 0,
        });
      }
    );

    test(
      'continues after one subscription fails',
      async () => {
        const db = buildDb([
          {
            id: 'google-sub-1',
            purchaseToken:
              'token-1',
          },
          {
            id: 'google-sub-2',
            purchaseToken:
              'token-2',
          },
        ]);

        db.googlePlaySubscription
          .updateMany
          .mockResolvedValue({
            count: 1,
          });

        const refreshFn =
          jest.fn()
            .mockRejectedValueOnce(
              Object.assign(
                new Error('temporary failure'),
                {
                  code: 'EAI_AGAIN',
                }
              )
            )
            .mockResolvedValueOnce({
              subscription: {
                id: 'google-sub-2',
              },
            });

        const summary =
          await runGooglePlayReconciliationBatch({
            db,
            refreshFn,
            clock: () => fixedNow,
            loggerInstance:
              buildLogger(),
          });

        expect(refreshFn)
          .toHaveBeenCalledTimes(2);

        expect(summary).toEqual({
          selected: 2,
          claimed: 2,
          refreshed: 1,
          failed: 1,
          leaseSkipped: 0,
          leaseReleaseFailed: 0,
        });
      }
    );

    test(
      'returns an empty summary when nothing is due',
      async () => {
        const db = buildDb([]);
        const refreshFn = jest.fn();

        const summary =
          await runGooglePlayReconciliationBatch({
            db,
            refreshFn,
            clock: () => fixedNow,
            loggerInstance:
              buildLogger(),
          });

        expect(refreshFn)
          .not.toHaveBeenCalled();

        expect(
          db.googlePlaySubscription
            .updateMany
        ).not.toHaveBeenCalled();

        expect(summary).toEqual({
          selected: 0,
          claimed: 0,
          refreshed: 0,
          failed: 0,
          leaseSkipped: 0,
          leaseReleaseFailed: 0,
        });
      }
    );
  }
);
