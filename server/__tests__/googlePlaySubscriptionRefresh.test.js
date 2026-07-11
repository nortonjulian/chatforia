/**
 * @jest-environment node
 */
import { jest } from '@jest/globals';

let prismaMock;
let verifyAndApplyMock;
let refreshGooglePlaySubscription;

beforeAll(async () => {
  await jest.unstable_mockModule(
    '../utils/prismaClient.js',
    () => {
      prismaMock = {
        googlePlaySubscription: {
          findUnique: jest.fn(),
          update: jest.fn(),
        },
      };

      return {
        __esModule: true,
        default: prismaMock,
      };
    }
  );

  await jest.unstable_mockModule(
    '../services/googlePlayEntitlementService.js',
    () => {
      verifyAndApplyMock = jest.fn();

      return {
        __esModule: true,
        verifyAndApplyGooglePlaySubscription:
          verifyAndApplyMock,
      };
    }
  );

  ({
    refreshGooglePlaySubscription,
  } = await import(
    '../services/googlePlaySubscriptionRefreshService.js'
  ));
});

beforeEach(() => {
  jest.clearAllMocks();

  prismaMock.googlePlaySubscription
    .findUnique
    .mockResolvedValue(null);

  prismaMock.googlePlaySubscription
    .update
    .mockResolvedValue({
      id: 'google-sub-1',
    });

  verifyAndApplyMock.mockResolvedValue({
    subscription: {
      id: 'google-sub-1',
      userId: 1,
    },
    user: {
      id: 1,
      plan: 'PLUS',
    },
    verified: {
      entitlementPlan: 'PLUS',
    },
  });
});

describe(
  'refreshGooglePlaySubscription',
  () => {
    test(
      'uses the authenticated user for device verification',
      async () => {
        const result =
          await refreshGooglePlaySubscription({
            userId: 1,
            purchaseToken: 'token-1',
            source: 'DEVICE',
          });

        expect(
          prismaMock
            .googlePlaySubscription
            .findUnique
        ).toHaveBeenCalledWith({
          where: {
            purchaseToken: 'token-1',
          },
          select: {
            id: true,
            userId: true,
          },
        });

        expect(
          verifyAndApplyMock
        ).toHaveBeenCalledWith({
          userId: 1,
          purchaseToken: 'token-1',
        });

        expect(
          prismaMock
            .googlePlaySubscription
            .update
        ).not.toHaveBeenCalled();

        expect(result.refreshSource)
          .toBe('DEVICE');
      }
    );

    test(
      'requires an authenticated user for device verification',
      async () => {
        await expect(
          refreshGooglePlaySubscription({
            purchaseToken: 'token-1',
            source: 'DEVICE',
          })
        ).rejects.toMatchObject({
          statusCode: 401,
          code: 'UNAUTHORIZED',
        });

        expect(
          prismaMock
            .googlePlaySubscription
            .findUnique
        ).not.toHaveBeenCalled();

        expect(
          verifyAndApplyMock
        ).not.toHaveBeenCalled();
      }
    );

    test(
      'rejects a device purchase linked to another user',
      async () => {
        prismaMock
          .googlePlaySubscription
          .findUnique
          .mockResolvedValue({
            id: 'google-sub-1',
            userId: 2,
          });

        await expect(
          refreshGooglePlaySubscription({
            userId: 1,
            purchaseToken: 'token-1',
            source: 'DEVICE',
          })
        ).rejects.toMatchObject({
          statusCode: 409,
          code:
            'GOOGLE_PLAY_TOKEN_ALREADY_LINKED',
        });

        expect(
          verifyAndApplyMock
        ).not.toHaveBeenCalled();
      }
    );

    test(
      'resolves the existing owner for RTDN',
      async () => {
        prismaMock
          .googlePlaySubscription
          .findUnique
          .mockResolvedValue({
            id: 'google-sub-1',
            userId: 24,
          });

        verifyAndApplyMock.mockResolvedValue({
          subscription: {
            id: 'google-sub-1',
            userId: 24,
          },
          user: {
            id: 24,
            plan: 'PREMIUM',
          },
        });

        const eventTime =
          new Date(
            '2026-07-11T18:00:00.000Z'
          );

        const result =
          await refreshGooglePlaySubscription({
            purchaseToken: 'token-1',
            source: 'RTDN',
            rtdnEventTime: eventTime,
            rtdnNotificationType: 2,
          });

        expect(
          verifyAndApplyMock
        ).toHaveBeenCalledWith({
          userId: 24,
          purchaseToken: 'token-1',
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
            lastRtdnAt: eventTime,
            lastRtdnNotificationType: 2,
          },
        });

        expect(result.refreshSource)
          .toBe('RTDN');
      }
    );

    test(
      'does not assign an unknown RTDN token to a user',
      async () => {
        await expect(
          refreshGooglePlaySubscription({
            purchaseToken:
              'unknown-token',
            source: 'RTDN',
            rtdnEventTime:
              new Date(
                '2026-07-11T18:00:00.000Z'
              ),
            rtdnNotificationType: 2,
          })
        ).rejects.toMatchObject({
          statusCode: 404,
          code:
            'GOOGLE_PLAY_SUBSCRIPTION_NOT_LINKED',
        });

        expect(
          verifyAndApplyMock
        ).not.toHaveBeenCalled();
      }
    );

    test(
      'resolves the existing owner for reconciliation',
      async () => {
        prismaMock
          .googlePlaySubscription
          .findUnique
          .mockResolvedValue({
            id: 'google-sub-1',
            userId: 8,
          });

        await refreshGooglePlaySubscription({
          purchaseToken: 'token-1',
          source: 'RECONCILIATION',
        });

        expect(
          verifyAndApplyMock
        ).toHaveBeenCalledWith({
          userId: 8,
          purchaseToken: 'token-1',
        });

        expect(
          prismaMock
            .googlePlaySubscription
            .update
        ).not.toHaveBeenCalled();
      }
    );

    test(
      'requires an event time for RTDN',
      async () => {
        await expect(
          refreshGooglePlaySubscription({
            purchaseToken: 'token-1',
            source: 'RTDN',
            rtdnNotificationType: 2,
          })
        ).rejects.toMatchObject({
          statusCode: 400,
          code:
            'GOOGLE_PLAY_RTDN_EVENT_TIME_REQUIRED',
        });

        expect(
          prismaMock
            .googlePlaySubscription
            .findUnique
        ).not.toHaveBeenCalled();
      }
    );
  }
);
