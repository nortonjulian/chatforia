/**
 * @jest-environment node
 */
import { createHash } from 'crypto';

import {
  parseGooglePlayRtdnPush,
} from '../services/googlePlayRtdnParser.js';

const packageName = 'com.chatforia.app';

function encode(value) {
  return Buffer.from(
    JSON.stringify(value),
    'utf8'
  ).toString('base64');
}

function buildBody(
  developerNotification,
  overrides = {}
) {
  return {
    deliveryAttempt: 2,
    message: {
      messageId: 'message-123',
      publishTime:
        '2026-07-11T18:00:00.000Z',
      data: encode(developerNotification),
      ...(overrides.message || {}),
    },
    subscription:
      'projects/project/subscriptions/rtdn',
    ...overrides,
  };
}

function subscriptionNotification(
  overrides = {}
) {
  return {
    version: '1.0',
    packageName,
    eventTimeMillis: '1783792800000',
    subscriptionNotification: {
      version: '1.0',
      notificationType: 2,
      purchaseToken: 'secret-purchase-token',
    },
    ...overrides,
  };
}

describe('parseGooglePlayRtdnPush', () => {
  test('parses a wrapped subscription notification', () => {
    const result =
      parseGooglePlayRtdnPush(
        buildBody(
          subscriptionNotification()
        ),
        {
          expectedPackageName: packageName,
        }
      );

    expect(result).toEqual({
      pubsubMessageId: 'message-123',
      subscription:
        'projects/project/subscriptions/rtdn',
      publishTime:
        new Date(
          '2026-07-11T18:00:00.000Z'
        ),
      deliveryAttempt: 2,

      packageName,
      eventTime:
        new Date(1783792800000),

      developerNotificationVersion: '1.0',
      eventKind: 'SUBSCRIPTION',
      notificationVersion: '1.0',
      notificationType: 2,
      purchaseToken:
        'secret-purchase-token',
      purchaseTokenHash:
        createHash('sha256')
          .update(
            'secret-purchase-token',
            'utf8'
          )
          .digest('hex'),
    });
  });

  test('accepts Pub/Sub snake_case metadata fields', () => {
    const body =
      buildBody(
        subscriptionNotification()
      );

    body.message.message_id =
      body.message.messageId;

    body.message.publish_time =
      body.message.publishTime;

    delete body.message.messageId;
    delete body.message.publishTime;

    const result =
      parseGooglePlayRtdnPush(
        body,
        {
          expectedPackageName: packageName,
        }
      );

    expect(result.pubsubMessageId)
      .toBe('message-123');

    expect(result.publishTime)
      .toEqual(
        new Date(
          '2026-07-11T18:00:00.000Z'
        )
      );
  });

  test('parses a test notification without a purchase token', () => {
    const result =
      parseGooglePlayRtdnPush(
        buildBody({
          version: '1.0',
          packageName,
          eventTimeMillis:
            '1783792800000',
          testNotification: {
            version: '1.0',
          },
        }),
        {
          expectedPackageName: packageName,
        }
      );

    expect(result).toEqual(
      expect.objectContaining({
        eventKind: 'TEST',
        notificationVersion: '1.0',
        notificationType: null,
        purchaseToken: null,
        purchaseTokenHash: null,
      })
    );
  });

  test('classifies a future unknown event type without exposing data', () => {
    const result =
      parseGooglePlayRtdnPush(
        buildBody({
          version: '2.0',
          packageName,
          eventTimeMillis:
            '1783792800000',
          futureNotification: {
            value: true,
          },
        }),
        {
          expectedPackageName: packageName,
        }
      );

    expect(result).toEqual(
      expect.objectContaining({
        eventKind: 'UNKNOWN',
        notificationVersion: '2.0',
        notificationType: null,
        purchaseToken: null,
        purchaseTokenHash: null,
      })
    );
  });

  test('rejects a mismatched package name', () => {
    expect(() =>
      parseGooglePlayRtdnPush(
        buildBody(
          subscriptionNotification({
            packageName:
              'com.attacker.application',
          })
        ),
        {
          expectedPackageName: packageName,
        }
      )
    ).toThrow(
      expect.objectContaining({
        statusCode: 400,
        code:
          'GOOGLE_PLAY_RTDN_PACKAGE_MISMATCH',
      })
    );
  });

  test('rejects malformed base64 data', () => {
    const body =
      buildBody(
        subscriptionNotification()
      );

    body.message.data = '%%%invalid%%%';

    expect(() =>
      parseGooglePlayRtdnPush(
        body,
        {
          expectedPackageName: packageName,
        }
      )
    ).toThrow(
      expect.objectContaining({
        code:
          'GOOGLE_PLAY_RTDN_DATA_INVALID_BASE64',
      })
    );
  });

  test('rejects decoded data that is not JSON', () => {
    const body =
      buildBody(
        subscriptionNotification()
      );

    body.message.data =
      Buffer.from(
        'not-json',
        'utf8'
      ).toString('base64');

    expect(() =>
      parseGooglePlayRtdnPush(
        body,
        {
          expectedPackageName: packageName,
        }
      )
    ).toThrow(
      expect.objectContaining({
        code:
          'GOOGLE_PLAY_RTDN_DATA_INVALID_JSON',
      })
    );
  });

  test('rejects a missing Pub/Sub message ID', () => {
    const body =
      buildBody(
        subscriptionNotification()
      );

    delete body.message.messageId;

    expect(() =>
      parseGooglePlayRtdnPush(
        body,
        {
          expectedPackageName: packageName,
        }
      )
    ).toThrow(
      expect.objectContaining({
        code:
          'GOOGLE_PLAY_RTDN_MESSAGE_ID_REQUIRED',
      })
    );
  });

  test('rejects multiple mutually exclusive notification types', () => {
    expect(() =>
      parseGooglePlayRtdnPush(
        buildBody(
          subscriptionNotification({
            testNotification: {
              version: '1.0',
            },
          })
        ),
        {
          expectedPackageName: packageName,
        }
      )
    ).toThrow(
      expect.objectContaining({
        code:
          'GOOGLE_PLAY_RTDN_MULTIPLE_EVENT_TYPES',
      })
    );
  });

  test('rejects a subscription notification without a purchase token', () => {
    expect(() =>
      parseGooglePlayRtdnPush(
        buildBody(
          subscriptionNotification({
            subscriptionNotification: {
              version: '1.0',
              notificationType: 2,
            },
          })
        ),
        {
          expectedPackageName: packageName,
        }
      )
    ).toThrow(
      expect.objectContaining({
        code:
          'GOOGLE_PLAY_RTDN_PURCHASE_TOKEN_REQUIRED',
      })
    );
  });

  test('rejects an invalid event timestamp', () => {
    expect(() =>
      parseGooglePlayRtdnPush(
        buildBody(
          subscriptionNotification({
            eventTimeMillis: 'not-a-time',
          })
        ),
        {
          expectedPackageName: packageName,
        }
      )
    ).toThrow(
      expect.objectContaining({
        code:
          'GOOGLE_PLAY_RTDN_EVENT_TIME_INVALID',
      })
    );
  });
});
