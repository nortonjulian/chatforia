/**
 * @jest-environment node
 */
import { jest } from '@jest/globals';

let prismaMock;
let processGooglePlayRtdnPush;

beforeAll(async () => {
  await jest.unstable_mockModule(
    '../utils/prismaClient.js',
    () => {
      prismaMock = {};

      return {
        __esModule: true,
        default: prismaMock,
      };
    }
  );

  ({
    processGooglePlayRtdnPush,
  } = await import(
    '../services/googlePlayRtdnService.js'
  ));
});

function buildParsed(overrides = {}) {
  return {
    pubsubMessageId: 'message-123',
    packageName: 'com.chatforia.app',
    eventKind: 'SUBSCRIPTION',

    developerNotificationVersion: '1.0',
    notificationVersion: '1.0',
    notificationType: 2,

    purchaseToken: 'secret-purchase-token',
    purchaseTokenHash: 'token-hash',

    voidedProductType: null,
    voidedRefundType: null,
    voidedOrderId: null,

    eventTime:
      new Date('2026-07-11T18:00:00.000Z'),

    publishTime:
      new Date('2026-07-11T18:00:01.000Z'),

    ...overrides,
  };
}

function buildDb() {
  return {
    googlePlayRtdnEvent: {
      create: jest.fn().mockResolvedValue({
        id: 'event-1',
        status: 'PROCESSING',
      }),

      findUnique: jest.fn(),

      updateMany: jest.fn().mockResolvedValue({
        count: 1,
      }),

      update: jest.fn().mockResolvedValue({
        id: 'event-1',
      }),
    },
  };
}

function duplicateError() {
  return Object.assign(
    new Error('duplicate'),
    {
      code: 'P2002',
    }
  );
}

describe('processGooglePlayRtdnPush', () => {
  test('processes a new subscription event', async () => {
    const db = buildDb();
    const parsed = buildParsed();

    const parseFn = jest.fn(() => parsed);

    const refreshFn = jest.fn().mockResolvedValue({
      subscription: {
        id: 'google-sub-1',
      },
      user: {
        id: 1,
        plan: 'PLUS',
      },
    });

    const result =
      await processGooglePlayRtdnPush(
        { message: {} },
        {
          db,
          parseFn,
          refreshFn,
        }
      );

    expect(
      db.googlePlayRtdnEvent.create
    ).toHaveBeenCalledWith({
      data: {
        pubsubMessageId: 'message-123',
        packageName: 'com.chatforia.app',
        eventKind: 'SUBSCRIPTION',
        notificationVersion: '1.0',
        notificationType: 2,
        purchaseTokenHash: 'token-hash',
        eventTime: parsed.eventTime,
        publishTime: parsed.publishTime,
        status: 'PROCESSING',
        attempts: 1,
      },
    });

    expect(refreshFn).toHaveBeenCalledWith({
      purchaseToken:
        'secret-purchase-token',
      source: 'RTDN',
      rtdnEventTime: parsed.eventTime,
      rtdnNotificationType: 2,
      db,
    });

    expect(
      db.googlePlayRtdnEvent.update
    ).toHaveBeenCalledWith({
      where: {
        id: 'event-1',
      },
      data: {
        status: 'PROCESSED',
        googlePlaySubscriptionId:
          'google-sub-1',
        processedAt: expect.any(Date),
        lastErrorCode: null,
        lastErrorMessage: null,
      },
    });

    expect(result).toEqual(
      expect.objectContaining({
        acknowledged: true,
        duplicate: false,
        status: 'PROCESSED',
        eventId: 'event-1',
        googlePlaySubscriptionId:
          'google-sub-1',
      })
    );
  });

  test('acknowledges a terminal duplicate', async () => {
    const db = buildDb();

    db.googlePlayRtdnEvent.create
      .mockRejectedValue(
        duplicateError()
      );

    db.googlePlayRtdnEvent.findUnique
      .mockResolvedValue({
        id: 'event-1',
        status: 'PROCESSED',
        googlePlaySubscriptionId:
          'google-sub-1',
      });

    const refreshFn = jest.fn();

    const result =
      await processGooglePlayRtdnPush(
        {},
        {
          db,
          parseFn: () => buildParsed(),
          refreshFn,
        }
      );

    expect(result).toEqual({
      acknowledged: true,
      duplicate: true,
      status: 'PROCESSED',
      eventId: 'event-1',
      googlePlaySubscriptionId:
        'google-sub-1',
    });

    expect(refreshFn)
      .not.toHaveBeenCalled();
  });

  test('refreshes a voided subscription purchase', async () => {
    const db = buildDb();

    const eventTime =
      new Date(
        '2026-07-11T18:00:00.000Z'
      );

    const refreshFn =
      jest.fn().mockResolvedValue({
        subscription: {
          id: 'google-sub-voided',
        },
      });

    const result =
      await processGooglePlayRtdnPush(
        {},
        {
          db,

          parseFn: () =>
            buildParsed({
              eventKind:
                'VOIDED_PURCHASE',

              notificationType: null,

              purchaseToken:
                'voided-subscription-token',

              voidedProductType: 1,
              voidedRefundType: 1,

              voidedOrderId:
                'GPA.1234-5678',

              eventTime,
            }),

          refreshFn,
        }
      );

    expect(refreshFn).toHaveBeenCalledWith({
      purchaseToken:
        'voided-subscription-token',

      source: 'RTDN',
      rtdnEventTime: eventTime,
      rtdnNotificationType: null,
      db,
    });

    expect(result).toEqual(
      expect.objectContaining({
        acknowledged: true,
        status: 'PROCESSED',

        googlePlaySubscriptionId:
          'google-sub-voided',
      })
    );
  });

  test('ignores a voided one-time purchase', async () => {
    const db = buildDb();
    const refreshFn = jest.fn();

    const result =
      await processGooglePlayRtdnPush(
        {},
        {
          db,

          parseFn: () =>
            buildParsed({
              eventKind:
                'VOIDED_PURCHASE',

              notificationType: null,

              purchaseToken:
                'voided-product-token',

              voidedProductType: 2,
              voidedRefundType: 1,

              voidedOrderId:
                'GPA.9876-5432',
            }),

          refreshFn,
        }
      );

    expect(result.status).toBe('IGNORED');

    expect(refreshFn)
      .not.toHaveBeenCalled();
  });

  test('intentionally ignores a test notification', async () => {
    const db = buildDb();
    const refreshFn = jest.fn();

    const result =
      await processGooglePlayRtdnPush(
        {},
        {
          db,

          parseFn: () =>
            buildParsed({
              eventKind: 'TEST',
              notificationType: null,
              purchaseToken: null,
              purchaseTokenHash: null,
            }),

          refreshFn,
        }
      );

    expect(
      db.googlePlayRtdnEvent.update
    ).toHaveBeenCalledWith({
      where: {
        id: 'event-1',
      },
      data: {
        status: 'IGNORED',
        processedAt: expect.any(Date),
        lastErrorCode: null,
        lastErrorMessage: null,
      },
    });

    expect(result.status).toBe('IGNORED');

    expect(refreshFn)
      .not.toHaveBeenCalled();
  });

  test('durably classifies an unknown token as unmatched', async () => {
    const db = buildDb();
    const token = 'secret-purchase-token';

    const refreshFn =
      jest.fn().mockRejectedValue(
        Object.assign(
          new Error(
            `No subscription for ${token}`
          ),
          {
            code:
              'GOOGLE_PLAY_SUBSCRIPTION_NOT_LINKED',
            statusCode: 404,
          }
        )
      );

    const result =
      await processGooglePlayRtdnPush(
        {},
        {
          db,
          parseFn: () => buildParsed(),
          refreshFn,
        }
      );

    const finalUpdate =
      db.googlePlayRtdnEvent.update
        .mock.calls[0][0];

    expect(finalUpdate.data.status)
      .toBe('UNMATCHED');

    expect(
      finalUpdate.data.lastErrorMessage
    ).toContain('[REDACTED]');

    expect(
      finalUpdate.data.lastErrorMessage
    ).not.toContain(token);

    expect(result).toEqual(
      expect.objectContaining({
        acknowledged: true,
        status: 'UNMATCHED',
      })
    );
  });

  test('stores a retryable failure and requests redelivery', async () => {
    const db = buildDb();
    const token = 'secret-purchase-token';

    const refreshFn =
      jest.fn().mockRejectedValue(
        Object.assign(
          new Error(
            `timeout while refreshing ${token}`
          ),
          {
            code: 'ETIMEDOUT',
          }
        )
      );

    await expect(
      processGooglePlayRtdnPush(
        {},
        {
          db,
          parseFn: () => buildParsed(),
          refreshFn,
        }
      )
    ).rejects.toMatchObject({
      statusCode: 503,
      code:
        'GOOGLE_PLAY_RTDN_RETRY_REQUIRED',
    });

    const finalUpdate =
      db.googlePlayRtdnEvent.update
        .mock.calls[0][0];

    expect(finalUpdate.data.status)
      .toBe('FAILED_RETRYABLE');

    expect(finalUpdate.data.processedAt)
      .toBeNull();

    expect(
      finalUpdate.data.lastErrorMessage
    ).toContain('[REDACTED]');

    expect(
      finalUpdate.data.lastErrorMessage
    ).not.toContain(token);
  });

  test('reclaims and processes a retryable event', async () => {
    const db = buildDb();

    db.googlePlayRtdnEvent.create
      .mockRejectedValue(
        duplicateError()
      );

    db.googlePlayRtdnEvent.findUnique
      .mockResolvedValueOnce({
        id: 'event-1',
        status: 'FAILED_RETRYABLE',
        updatedAt:
          new Date('2026-07-11T17:00:00Z'),
      })
      .mockResolvedValueOnce({
        id: 'event-1',
        status: 'PROCESSING',
      });

    const refreshFn =
      jest.fn().mockResolvedValue({
        subscription: {
          id: 'google-sub-1',
        },
      });

    const result =
      await processGooglePlayRtdnPush(
        {},
        {
          db,
          parseFn: () => buildParsed(),
          refreshFn,
        }
      );

    expect(
      db.googlePlayRtdnEvent.updateMany
    ).toHaveBeenCalledWith({
      where: {
        id: 'event-1',
        status: {
          in: [
            'RECEIVED',
            'FAILED_RETRYABLE',
          ],
        },
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

    expect(result).toEqual(
      expect.objectContaining({
        acknowledged: true,
        duplicate: true,
        status: 'PROCESSED',
      })
    );
  });

  test('rejects a duplicate that is actively processing', async () => {
    const db = buildDb();

    db.googlePlayRtdnEvent.create
      .mockRejectedValue(
        duplicateError()
      );

    db.googlePlayRtdnEvent.findUnique
      .mockResolvedValue({
        id: 'event-1',
        status: 'PROCESSING',
        updatedAt: new Date(),
      });

    await expect(
      processGooglePlayRtdnPush(
        {},
        {
          db,
          parseFn: () => buildParsed(),
          refreshFn: jest.fn(),
        }
      )
    ).rejects.toMatchObject({
      statusCode: 503,
      code:
        'GOOGLE_PLAY_RTDN_EVENT_IN_PROGRESS',
    });
  });

  test('reclaims stale processing left by a failed worker', async () => {
    const db = buildDb();

    db.googlePlayRtdnEvent.create
      .mockRejectedValue(
        duplicateError()
      );

    db.googlePlayRtdnEvent.findUnique
      .mockResolvedValueOnce({
        id: 'event-1',
        status: 'PROCESSING',
        updatedAt:
          new Date('2000-01-01T00:00:00Z'),
      })
      .mockResolvedValueOnce({
        id: 'event-1',
        status: 'PROCESSING',
      });

    const refreshFn =
      jest.fn().mockResolvedValue({
        subscription: {
          id: 'google-sub-1',
        },
      });

    const result =
      await processGooglePlayRtdnPush(
        {},
        {
          db,
          parseFn: () => buildParsed(),
          refreshFn,
        }
      );

    expect(
      db.googlePlayRtdnEvent.updateMany
    ).toHaveBeenCalledWith({
      where: {
        id: 'event-1',
        status: 'PROCESSING',
        updatedAt: {
          lte: expect.any(Date),
        },
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

    expect(result.status)
      .toBe('PROCESSED');
  });
});
