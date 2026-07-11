import { createHash } from 'crypto';

import {
  getGooglePlayPackageName,
} from './googlePlayBillingService.js';

const NOTIFICATION_KINDS = Object.freeze([
  {
    field: 'subscriptionNotification',
    eventKind: 'SUBSCRIPTION',
  },
  {
    field: 'testNotification',
    eventKind: 'TEST',
  },
  {
    field: 'oneTimeProductNotification',
    eventKind: 'ONE_TIME_PRODUCT',
  },
  {
    field: 'voidedPurchaseNotification',
    eventKind: 'VOIDED_PURCHASE',
  },
  {
    field: 'pendingRefundReviewNotification',
    eventKind: 'PENDING_REFUND_REVIEW',
  },
]);

function createParseError(message, code) {
  const error = new Error(message);
  error.statusCode = 400;
  error.code = code;
  return error;
}

function isObject(value) {
  return (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value)
  );
}

function nonEmptyString(value) {
  if (typeof value !== 'string') {
    return null;
  }

  const normalized = value.trim();
  return normalized || null;
}

function parseDate(value, {
  required = false,
  code,
  fieldName,
} = {}) {
  if (value === null || value === undefined || value === '') {
    if (required) {
      throw createParseError(
        `${fieldName} is required.`,
        code
      );
    }

    return null;
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    throw createParseError(
      `${fieldName} is invalid.`,
      code
    );
  }

  return date;
}

function parseEventTimeMillis(value) {
  const normalized =
    typeof value === 'string'
      ? value.trim()
      : value;

  if (
    normalized === '' ||
    normalized === null ||
    normalized === undefined
  ) {
    throw createParseError(
      'eventTimeMillis is required.',
      'GOOGLE_PLAY_RTDN_EVENT_TIME_REQUIRED'
    );
  }

  const millis = Number(normalized);

  if (
    !Number.isSafeInteger(millis) ||
    millis <= 0
  ) {
    throw createParseError(
      'eventTimeMillis is invalid.',
      'GOOGLE_PLAY_RTDN_EVENT_TIME_INVALID'
    );
  }

  return new Date(millis);
}

function decodeBase64Json(value) {
  const encoded = nonEmptyString(value);

  if (!encoded) {
    throw createParseError(
      'Pub/Sub message.data is required.',
      'GOOGLE_PLAY_RTDN_DATA_REQUIRED'
    );
  }

  if (
    !/^[A-Za-z0-9+/]*={0,2}$/.test(encoded) ||
    encoded.length % 4 === 1
  ) {
    throw createParseError(
      'Pub/Sub message.data is not valid base64.',
      'GOOGLE_PLAY_RTDN_DATA_INVALID_BASE64'
    );
  }

  const unpadded = encoded.replace(/=+$/, '');
  const padded = encoded.padEnd(
    Math.ceil(encoded.length / 4) * 4,
    '='
  );

  let buffer;

  try {
    buffer = Buffer.from(padded, 'base64');
  } catch {
    throw createParseError(
      'Pub/Sub message.data is not valid base64.',
      'GOOGLE_PLAY_RTDN_DATA_INVALID_BASE64'
    );
  }

  const canonical =
    buffer
      .toString('base64')
      .replace(/=+$/, '');

  if (canonical !== unpadded) {
    throw createParseError(
      'Pub/Sub message.data is not valid base64.',
      'GOOGLE_PLAY_RTDN_DATA_INVALID_BASE64'
    );
  }

  let decoded;

  try {
    decoded = JSON.parse(buffer.toString('utf8'));
  } catch {
    throw createParseError(
      'Pub/Sub message.data does not contain valid JSON.',
      'GOOGLE_PLAY_RTDN_DATA_INVALID_JSON'
    );
  }

  if (!isObject(decoded)) {
    throw createParseError(
      'The decoded Google Play notification must be an object.',
      'GOOGLE_PLAY_RTDN_DATA_INVALID'
    );
  }

  return decoded;
}

function hashPurchaseToken(purchaseToken) {
  if (!purchaseToken) {
    return null;
  }

  return createHash('sha256')
    .update(purchaseToken, 'utf8')
    .digest('hex');
}

function parseNotificationType(value) {
  const normalized = Number(value);

  if (
    !Number.isInteger(normalized) ||
    normalized <= 0
  ) {
    throw createParseError(
      'The notification type is invalid.',
      'GOOGLE_PLAY_RTDN_NOTIFICATION_TYPE_INVALID'
    );
  }

  return normalized;
}

function classifyDeveloperNotification(
  developerNotification
) {
  const presentKinds =
    NOTIFICATION_KINDS.filter(
      ({ field }) =>
        developerNotification[field] !==
          null &&
        developerNotification[field] !==
          undefined
    );

  if (presentKinds.length > 1) {
    throw createParseError(
      'The Google Play notification contains multiple event types.',
      'GOOGLE_PLAY_RTDN_MULTIPLE_EVENT_TYPES'
    );
  }

  if (presentKinds.length === 0) {
    return {
      eventKind: 'UNKNOWN',
      notificationVersion:
        nonEmptyString(
          developerNotification.version
        ),
      notificationType: null,
      purchaseToken: null,
      purchaseTokenHash: null,
      voidedProductType: null,
      voidedRefundType: null,
      voidedOrderId: null,
    };
  }

  const {
    field,
    eventKind,
  } = presentKinds[0];

  const detail =
    developerNotification[field];

  if (!isObject(detail)) {
    throw createParseError(
      `${field} must be an object.`,
      'GOOGLE_PLAY_RTDN_EVENT_INVALID'
    );
  }

  const notificationVersion =
    nonEmptyString(detail.version) ??
    nonEmptyString(
      developerNotification.version
    );

  let notificationType = null;

  let purchaseToken =
    nonEmptyString(detail.purchaseToken);

  let voidedProductType = null;
  let voidedRefundType = null;
  let voidedOrderId = null;

  if (
    eventKind === 'SUBSCRIPTION' ||
    eventKind === 'ONE_TIME_PRODUCT'
  ) {
    notificationType =
      parseNotificationType(
        detail.notificationType
      );
  }

  if (eventKind === 'VOIDED_PURCHASE') {
    if (!purchaseToken) {
      throw createParseError(
        'The voided purchase token is required.',
        'GOOGLE_PLAY_RTDN_PURCHASE_TOKEN_REQUIRED'
      );
    }

    voidedProductType =
      Number(detail.productType);

    if (
      !Number.isInteger(voidedProductType) ||
      voidedProductType <= 0
    ) {
      throw createParseError(
        'The voided purchase product type is invalid.',
        'GOOGLE_PLAY_RTDN_VOIDED_PRODUCT_TYPE_INVALID'
      );
    }

    voidedRefundType =
      Number(detail.refundType);

    if (
      !Number.isInteger(voidedRefundType) ||
      voidedRefundType <= 0
    ) {
      throw createParseError(
        'The voided purchase refund type is invalid.',
        'GOOGLE_PLAY_RTDN_VOIDED_REFUND_TYPE_INVALID'
      );
    }

    voidedOrderId =
      nonEmptyString(detail.orderId);
  }

  if (
    eventKind === 'SUBSCRIPTION' &&
    !purchaseToken
  ) {
    throw createParseError(
      'The subscription notification purchase token is required.',
      'GOOGLE_PLAY_RTDN_PURCHASE_TOKEN_REQUIRED'
    );
  }

  return {
    eventKind,
    notificationVersion,
    notificationType,
    purchaseToken,
    purchaseTokenHash:
      hashPurchaseToken(purchaseToken),

    voidedProductType,
    voidedRefundType,
    voidedOrderId,
  };
}

export function parseGooglePlayRtdnPush(
  body,
  {
    expectedPackageName =
      getGooglePlayPackageName(),
  } = {}
) {
  if (!isObject(body)) {
    throw createParseError(
      'The Pub/Sub request body must be an object.',
      'GOOGLE_PLAY_RTDN_BODY_INVALID'
    );
  }

  const message = body.message;

  if (!isObject(message)) {
    throw createParseError(
      'The Pub/Sub message object is required.',
      'GOOGLE_PLAY_RTDN_MESSAGE_REQUIRED'
    );
  }

  const pubsubMessageId =
    nonEmptyString(message.messageId) ??
    nonEmptyString(message.message_id);

  if (!pubsubMessageId) {
    throw createParseError(
      'The Pub/Sub message ID is required.',
      'GOOGLE_PLAY_RTDN_MESSAGE_ID_REQUIRED'
    );
  }

  const publishTimeValue =
    message.publishTime ??
    message.publish_time ??
    null;

  const publishTime = parseDate(
    publishTimeValue,
    {
      required: false,
      code:
        'GOOGLE_PLAY_RTDN_PUBLISH_TIME_INVALID',
      fieldName: 'publishTime',
    }
  );

  const developerNotification =
    decodeBase64Json(message.data);

  const packageName =
    nonEmptyString(
      developerNotification.packageName
    );

  if (!packageName) {
    throw createParseError(
      'The Google Play package name is required.',
      'GOOGLE_PLAY_RTDN_PACKAGE_REQUIRED'
    );
  }

  const normalizedExpectedPackage =
    nonEmptyString(expectedPackageName);

  if (
    !normalizedExpectedPackage ||
    packageName !== normalizedExpectedPackage
  ) {
    throw createParseError(
      'The Google Play package name is not authorized.',
      'GOOGLE_PLAY_RTDN_PACKAGE_MISMATCH'
    );
  }

  const eventTime =
    parseEventTimeMillis(
      developerNotification.eventTimeMillis
    );

  const classification =
    classifyDeveloperNotification(
      developerNotification
    );

  const deliveryAttemptValue =
    body.deliveryAttempt;

  const deliveryAttempt =
    Number.isInteger(
      Number(deliveryAttemptValue)
    ) &&
    Number(deliveryAttemptValue) >= 0
      ? Number(deliveryAttemptValue)
      : null;

  return {
    pubsubMessageId,
    subscription:
      nonEmptyString(body.subscription),
    publishTime,
    deliveryAttempt,

    packageName,
    eventTime,

    developerNotificationVersion:
      nonEmptyString(
        developerNotification.version
      ),

    ...classification,
  };
}
