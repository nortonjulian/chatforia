import { google } from 'googleapis';

const ANDROID_PUBLISHER_SCOPE =
  'https://www.googleapis.com/auth/androidpublisher';

const SUPPORTED_PRODUCTS = Object.freeze({
  chatforia_plus: Object.freeze({
    monthly: 'PLUS',
  }),

  chatforia_premium: Object.freeze({
    monthly: 'PREMIUM',
    annual: 'PREMIUM',
  }),
});

const ENTITLEMENT_PRIORITY = Object.freeze({
  FREE: 0,
  PLUS: 1,
  PREMIUM: 2,
});

const ACCESS_STATES = new Set([
  'SUBSCRIPTION_STATE_ACTIVE',
  'SUBSCRIPTION_STATE_IN_GRACE_PERIOD',
  'SUBSCRIPTION_STATE_CANCELED',
]);

let androidPublisherClient = null;

function getPackageName() {
  const packageName = process.env.GOOGLE_PLAY_PACKAGE_NAME?.trim();

  if (!packageName) {
    throw new Error('GOOGLE_PLAY_PACKAGE_NAME is not configured.');
  }

  return packageName;
}

export function getGooglePlayPackageName() {
  return getPackageName();
}

function getGooglePlayCredentialsPath() {
  const credentialsPath =
    process.env.GOOGLE_PLAY_APPLICATION_CREDENTIALS?.trim();

  if (!credentialsPath) {
    throw new Error(
      'GOOGLE_PLAY_APPLICATION_CREDENTIALS is not configured.'
    );
  }

  return credentialsPath;
}

function getAndroidPublisherClient() {
  if (androidPublisherClient) {
    return androidPublisherClient;
  }

  const auth = new google.auth.GoogleAuth({
    keyFilename: getGooglePlayCredentialsPath(),
    scopes: [ANDROID_PUBLISHER_SCOPE],
  });

  androidPublisherClient = google.androidpublisher({
    version: 'v3',
    auth,
  });

  return androidPublisherClient;
}

function toDateOrNull(value) {
  if (!value) {
    return null;
  }

  const date = new Date(value);

  return Number.isNaN(date.getTime()) ? null : date;
}

function sanitizeJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function normalizeLineItem(lineItem) {
  const productId = lineItem?.productId ?? null;
  const basePlanId = lineItem?.offerDetails?.basePlanId ?? null;

  const entitlementPlan =
    productId && basePlanId
      ? SUPPORTED_PRODUCTS[productId]?.[basePlanId] ?? null
      : null;

  if (!entitlementPlan) {
    return null;
  }

  return {
    productId,
    basePlanId,
    entitlementPlan,
    expiryTime: toDateOrNull(lineItem.expiryTime),
    latestOrderId:
      lineItem.latestSuccessfulOrderId ?? null,
    autoRenewEnabled:
      lineItem.autoRenewingPlan?.autoRenewEnabled ?? false,
  };
}

function chooseEntitlementLineItem(lineItems) {
  const supportedItems = lineItems
    .map(normalizeLineItem)
    .filter(Boolean);

  if (supportedItems.length === 0) {
    throw new Error(
      'The Google Play purchase does not contain a supported Chatforia subscription.'
    );
  }

  supportedItems.sort((left, right) => {
    const priorityDifference =
      ENTITLEMENT_PRIORITY[right.entitlementPlan] -
      ENTITLEMENT_PRIORITY[left.entitlementPlan];

    if (priorityDifference !== 0) {
      return priorityDifference;
    }

    const leftExpiry = left.expiryTime?.getTime() ?? 0;
    const rightExpiry = right.expiryTime?.getTime() ?? 0;

    return rightExpiry - leftExpiry;
  });

  return supportedItems[0];
}

export async function getGooglePlaySubscription(purchaseToken) {
  if (
    typeof purchaseToken !== 'string' ||
    purchaseToken.trim().length === 0
  ) {
    throw new Error('A Google Play purchase token is required.');
  }

  const packageName = getPackageName();
  const androidPublisher = getAndroidPublisherClient();

  const response =
    await androidPublisher.purchases.subscriptionsv2.get({
      packageName,
      token: purchaseToken.trim(),
    });

  return response.data;
}

export function normalizeGooglePlaySubscription(
  purchaseToken,
  googleSubscription
) {
  const lineItems = Array.isArray(googleSubscription?.lineItems)
    ? googleSubscription.lineItems
    : [];

  const selectedItem = chooseEntitlementLineItem(lineItems);

  const subscriptionState =
    googleSubscription?.subscriptionState ??
    'SUBSCRIPTION_STATE_UNSPECIFIED';

  const acknowledgementState =
    googleSubscription?.acknowledgementState ??
    'ACKNOWLEDGEMENT_STATE_UNSPECIFIED';

  const expiryTime = selectedItem.expiryTime;
  const isUnexpired =
    expiryTime instanceof Date &&
    expiryTime.getTime() > Date.now();

  const grantsAccess =
    ACCESS_STATES.has(subscriptionState) &&
    isUnexpired;

  return {
    packageName: getPackageName(),
    purchaseToken: purchaseToken.trim(),

    productId: selectedItem.productId,
    basePlanId: selectedItem.basePlanId,
    entitlementPlan: selectedItem.entitlementPlan,

    linkedPurchaseToken:
      googleSubscription?.linkedPurchaseToken ?? null,

    latestOrderId:
      selectedItem.latestOrderId ??
      googleSubscription?.latestOrderId ??
      null,

    subscriptionState,
    acknowledgementState,

    autoRenewEnabled:
      selectedItem.autoRenewEnabled,

    startTime:
      toDateOrNull(googleSubscription?.startTime),

    expiryTime,

    regionCode:
      googleSubscription?.regionCode ?? null,

    isTestPurchase:
      Boolean(googleSubscription?.testPurchase),

    grantsAccess,

    rawResponse:
      sanitizeJson(googleSubscription),
  };
}

export async function acknowledgeGooglePlaySubscription({
  purchaseToken,
  productId,
}) {
  if (!purchaseToken || !productId) {
    throw new Error(
      'purchaseToken and productId are required to acknowledge a subscription.'
    );
  }

  const androidPublisher = getAndroidPublisherClient();

  await androidPublisher.purchases.subscriptions.acknowledge({
    packageName: getPackageName(),
    subscriptionId: productId,
    token: purchaseToken,
    requestBody: {},
  });
}
