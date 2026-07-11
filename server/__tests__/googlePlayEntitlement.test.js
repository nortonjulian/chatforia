/**
 * @jest-environment node
 */
import { jest } from '@jest/globals';

let prismaMock;
let getGooglePlaySubscriptionMock;
let normalizeGooglePlaySubscriptionMock;
let acknowledgeGooglePlaySubscriptionMock;
let recomputeUserAppEntitlementMock;
let verifyAndApplyGooglePlaySubscription;

beforeAll(async () => {
  await jest.unstable_mockModule(
    '../utils/prismaClient.js',
    () => {
      prismaMock = {
        user: {
          findUnique: jest.fn(),
        },

        googlePlaySubscription: {
          findUnique: jest.fn(),
          upsert: jest.fn(),
          update: jest.fn(),
        },

        appSubscription: {
          upsert: jest.fn(),
          updateMany: jest.fn(),
        },

        $transaction: jest.fn(),
      };

      return {
        __esModule: true,
        default: prismaMock,
      };
    }
  );

  await jest.unstable_mockModule(
    '../services/googlePlayBillingService.js',
    () => {
      getGooglePlaySubscriptionMock =
        jest.fn();

      normalizeGooglePlaySubscriptionMock =
        jest.fn();

      acknowledgeGooglePlaySubscriptionMock =
        jest.fn();

      return {
        __esModule: true,
        getGooglePlaySubscription:
          getGooglePlaySubscriptionMock,
        normalizeGooglePlaySubscription:
          normalizeGooglePlaySubscriptionMock,
        acknowledgeGooglePlaySubscription:
          acknowledgeGooglePlaySubscriptionMock,
      };
    }
  );

  await jest.unstable_mockModule(
    '../services/appEntitlementService.js',
    () => {
      recomputeUserAppEntitlementMock =
        jest.fn();

      return {
        __esModule: true,
        recomputeUserAppEntitlement:
          recomputeUserAppEntitlementMock,
      };
    }
  );

  ({
    verifyAndApplyGooglePlaySubscription,
  } = await import(
    '../services/googlePlayEntitlementService.js'
  ));
});

function buildVerified(overrides = {}) {
  return {
    packageName: 'com.chatforia.app',
    purchaseToken: 'secret-purchase-token',

    productId: 'chatforia_plus',
    basePlanId: 'monthly',
    entitlementPlan: 'PLUS',

    linkedPurchaseToken: null,
    latestOrderId: 'order-123',

    subscriptionState:
      'SUBSCRIPTION_STATE_ACTIVE',

    acknowledgementState:
      'ACKNOWLEDGEMENT_STATE_ACKNOWLEDGED',

    autoRenewEnabled: true,

    startTime:
      new Date('2026-07-01T00:00:00.000Z'),

    expiryTime:
      new Date('2026-08-01T00:00:00.000Z'),

    regionCode: 'US',
    isTestPurchase: true,
    grantsAccess: true,

    rawResponse: {
      source: 'test',
    },

    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();

  prismaMock.$transaction.mockImplementation(
    async (callback) => callback(prismaMock)
  );

  prismaMock.user.findUnique.mockResolvedValue({
    id: 1,
  });

  prismaMock.googlePlaySubscription
    .findUnique
    .mockResolvedValue(null);

  prismaMock.googlePlaySubscription
    .upsert
    .mockResolvedValue({
      id: 'google-sub-1',
      userId: 1,
      acknowledgementAttemptCount: 0,
    });

  prismaMock.googlePlaySubscription
    .update
    .mockResolvedValue({
      id: 'google-sub-1',
    });

  prismaMock.appSubscription
    .upsert
    .mockResolvedValue({
      id: 'app-sub-1',
      userId: 1,
    });

  prismaMock.appSubscription
    .updateMany
    .mockResolvedValue({
      count: 1,
    });

  recomputeUserAppEntitlementMock
    .mockResolvedValue({
      user: {
        id: 1,
        plan: 'PLUS',
        subscriptionStatus: 'ACTIVE',
      },
    });

  getGooglePlaySubscriptionMock
    .mockResolvedValue({
      source: 'google',
    });

  normalizeGooglePlaySubscriptionMock
    .mockReturnValue(
      buildVerified()
    );

  acknowledgeGooglePlaySubscriptionMock
    .mockResolvedValue(undefined);
});

describe(
  'verifyAndApplyGooglePlaySubscription',
  () => {
    test(
      'stores verification time and access snapshot',
      async () => {
        const result =
          await verifyAndApplyGooglePlaySubscription({
            userId: 1,
            purchaseToken:
              'secret-purchase-token',
          });

        const upsert =
          prismaMock
            .googlePlaySubscription
            .upsert
            .mock.calls[0][0];

        expect(upsert.create).toEqual(
          expect.objectContaining({
            userId: 1,
            purchaseToken:
              'secret-purchase-token',

            lastVerifiedAt:
              expect.any(Date),

            lastVerificationErrorCode:
              null,

            lastVerificationErrorMessage:
              null,

            accessGrantedSnapshot:
              true,

            nextAcknowledgementAttemptAt:
              null,

            lastAcknowledgementErrorCode:
              null,

            lastAcknowledgementErrorMessage:
              null,
          })
        );

        expect(result).toEqual(
          expect.objectContaining({
            acknowledged: true,
            acknowledgementPending:
              false,
            acknowledgementAttempted:
              false,
            acknowledgementErrorCode:
              null,
            acknowledgementErrorMessage:
              null,
          })
        );

        expect(
          acknowledgeGooglePlaySubscriptionMock
        ).not.toHaveBeenCalled();
      }
    );

    test(
      'persists a successful acknowledgement attempt',
      async () => {
        normalizeGooglePlaySubscriptionMock
          .mockReturnValue(
            buildVerified({
              acknowledgementState:
                'ACKNOWLEDGEMENT_STATE_PENDING',
            })
          );

        const result =
          await verifyAndApplyGooglePlaySubscription({
            userId: 1,
            purchaseToken:
              'secret-purchase-token',
          });

        expect(
          acknowledgeGooglePlaySubscriptionMock
        ).toHaveBeenCalledWith({
          purchaseToken:
            'secret-purchase-token',
          productId:
            'chatforia_plus',
        });

        expect(
          prismaMock
            .googlePlaySubscription
            .update
        ).toHaveBeenCalledWith({
          where: {
            id: 'google-sub-1',
          },
          data: {
            acknowledgementState:
              'ACKNOWLEDGEMENT_STATE_ACKNOWLEDGED',

            acknowledgementAttemptCount: {
              increment: 1,
            },

            lastAcknowledgementAttemptAt:
              expect.any(Date),

            nextAcknowledgementAttemptAt:
              null,

            lastAcknowledgementErrorCode:
              null,

            lastAcknowledgementErrorMessage:
              null,
          },
        });

        expect(result).toEqual(
          expect.objectContaining({
            acknowledged: true,
            acknowledgementPending:
              false,
            acknowledgementAttempted:
              true,
            acknowledgementErrorCode:
              null,
            acknowledgementErrorMessage:
              null,
          })
        );
      }
    );

    test(
      'persists a redacted acknowledgement failure and retry time',
      async () => {
        const token =
          'secret-purchase-token';

        normalizeGooglePlaySubscriptionMock
          .mockReturnValue(
            buildVerified({
              purchaseToken: token,
              acknowledgementState:
                'ACKNOWLEDGEMENT_STATE_PENDING',
            })
          );

        acknowledgeGooglePlaySubscriptionMock
          .mockRejectedValue(
            Object.assign(
              new Error(
                `provider failed for ${token}`
              ),
              {
                code: 'ETIMEDOUT',
              }
            )
          );

        const consoleError =
          jest
            .spyOn(console, 'error')
            .mockImplementation(() => {});

        const result =
          await verifyAndApplyGooglePlaySubscription({
            userId: 1,
            purchaseToken: token,
          });

        const failureUpdate =
          prismaMock
            .googlePlaySubscription
            .update
            .mock.calls[0][0];

        expect(failureUpdate.where).toEqual({
          id: 'google-sub-1',
        });

        expect(
          failureUpdate
            .data
            .acknowledgementAttemptCount
        ).toEqual({
          increment: 1,
        });

        expect(
          failureUpdate
            .data
            .lastAcknowledgementAttemptAt
        ).toEqual(expect.any(Date));

        expect(
          failureUpdate
            .data
            .nextAcknowledgementAttemptAt
        ).toEqual(expect.any(Date));

        expect(
          failureUpdate
            .data
            .nextAcknowledgementAttemptAt
            .getTime()
        ).toBeGreaterThan(
          failureUpdate
            .data
            .lastAcknowledgementAttemptAt
            .getTime()
        );

        expect(
          failureUpdate
            .data
            .lastAcknowledgementErrorCode
        ).toBe('ETIMEDOUT');

        expect(
          failureUpdate
            .data
            .lastAcknowledgementErrorMessage
        ).toContain('[REDACTED]');

        expect(
          failureUpdate
            .data
            .lastAcknowledgementErrorMessage
        ).not.toContain(token);

        expect(result).toEqual(
          expect.objectContaining({
            acknowledged: false,
            acknowledgementPending:
              true,
            acknowledgementAttempted:
              true,
            acknowledgementErrorCode:
              'ETIMEDOUT',
          })
        );

        expect(
          result.acknowledgementErrorMessage
        ).not.toContain(token);

        expect(
          JSON.stringify(
            consoleError.mock.calls
          )
        ).not.toContain(token);

        consoleError.mockRestore();
      }
    );

    test(
      'marks a linked predecessor as superseded',
      async () => {
        normalizeGooglePlaySubscriptionMock
          .mockReturnValue(
            buildVerified({
              linkedPurchaseToken:
                'old-purchase-token',
            })
          );

        prismaMock
          .googlePlaySubscription
          .findUnique
          .mockResolvedValueOnce(null)
          .mockResolvedValueOnce({
            id: 'google-sub-old',
            userId: 1,
          });

        await verifyAndApplyGooglePlaySubscription({
          userId: 1,
          purchaseToken:
            'secret-purchase-token',
        });

        expect(
          prismaMock
            .googlePlaySubscription
            .update
        ).toHaveBeenCalledWith({
          where: {
            id: 'google-sub-old',
          },
          data: {
            supersededAt:
              expect.any(Date),
            accessGrantedSnapshot:
              false,
          },
        });

        expect(
          prismaMock
            .appSubscription
            .updateMany
        ).toHaveBeenCalledWith({
          where: {
            provider: 'GOOGLE_PLAY',
            providerSubscriptionKey:
              'google-play:google-sub-old',
          },
          data: {
            status: 'SUPERSEDED',
            grantsAccess: false,
            endsAt: expect.any(Date),
            lastVerifiedAt:
              expect.any(Date),
            rawResponse: {
              source: 'google-play',
              reason:
                'linked-purchase-replaced',
            },
          },
        });
      }
    );

    test(
      'clears stale acknowledgement retry state when access is no longer granted',
      async () => {
        normalizeGooglePlaySubscriptionMock
          .mockReturnValue(
            buildVerified({
              subscriptionState:
                'SUBSCRIPTION_STATE_EXPIRED',

              acknowledgementState:
                'ACKNOWLEDGEMENT_STATE_PENDING',

              grantsAccess: false,
            })
          );

        const result =
          await verifyAndApplyGooglePlaySubscription({
            userId: 1,
            purchaseToken:
              'secret-purchase-token',
          });

        const update =
          prismaMock
            .googlePlaySubscription
            .upsert
            .mock.calls[0][0]
            .update;

        expect(update).toEqual(
          expect.objectContaining({
            accessGrantedSnapshot:
              false,

            nextAcknowledgementAttemptAt:
              null,

            lastAcknowledgementErrorCode:
              null,

            lastAcknowledgementErrorMessage:
              null,
          })
        );

        expect(
          acknowledgeGooglePlaySubscriptionMock
        ).not.toHaveBeenCalled();

        expect(result).toEqual(
          expect.objectContaining({
            acknowledged: false,
            acknowledgementPending:
              false,
            acknowledgementAttempted:
              false,
          })
        );
      }
    );
  }
);
