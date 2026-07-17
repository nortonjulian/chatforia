/**
 * @jest-environment node
 */
import { jest } from '@jest/globals';

process.env.APPLE_BUNDLE_ID = 'com.chatforia.Chatforia';

process.env.APPLE_IAP_ENV = 'sandbox';

let assertProviderAvailableMock;
let recomputeEntitlementMock;
let verifyAndApplyAppleSubscription;

await jest.unstable_mockModule('../utils/prismaClient.js', () => ({
  __esModule: true,
  default: {},
}));

await jest.unstable_mockModule('../services/appEntitlementService.js', () => {
  assertProviderAvailableMock = jest.fn();

  recomputeEntitlementMock = jest.fn();

  return {
    __esModule: true,

    assertAppSubscriptionProviderAvailable: assertProviderAvailableMock,

    recomputeUserAppEntitlement: recomputeEntitlementMock,
  };
});

({ verifyAndApplyAppleSubscription } = await import(
  '../services/appleEntitlementService.js'
));

const NOW = new Date('2026-07-16T23:00:00.000Z');

function makeTransaction(overrides = {}) {
  return {
    bundleId: 'com.chatforia.Chatforia',

    environment: 'Sandbox',

    transactionId: '2000001234567890',

    originalTransactionId: '2000001234567000',

    productId: 'plus.monthly',

    purchaseDate: NOW.getTime() - 60_000,

    expiresDate: NOW.getTime() + 86_400_000,

    appAccountToken: null,

    revocationDate: null,

    ...overrides,
  };
}

function makeDb(existing = null) {
  const db = {
    appSubscription: {
      findUnique: jest.fn().mockResolvedValue(existing),

      upsert: jest.fn().mockResolvedValue({
        id: 'apple-subscription-1',
      }),
    },
  };

  db.$transaction = jest.fn(async (callback) => callback(db));

  return db;
}

function makeActiveUser() {
  return {
    id: 1,
    plan: 'PLUS',
    subscriptionStatus: 'ACTIVE',
    subscriptionEndsAt: new Date(NOW.getTime() + 86_400_000),
    billingProvider: 'APPLE',
    billingSubscriptionId: '2000001234567000',
  };
}

beforeEach(() => {
  jest.clearAllMocks();

  assertProviderAvailableMock.mockResolvedValue(null);

  recomputeEntitlementMock.mockResolvedValue({
    user: makeActiveUser(),
    selectedEntitlement: {
      provider: 'APPLE',
      plan: 'PLUS',
    },
  });
});

test('creates an active Apple Plus entitlement', async () => {
  const db = makeDb();
  const transaction = makeTransaction();

  const result = await verifyAndApplyAppleSubscription({
    userId: 1,
    signedTransactionInfo: 'signed-apple-jws',
    db,
    now: NOW,

    verifyTransaction: jest.fn().mockResolvedValue(transaction),
  });

  expect(assertProviderAvailableMock).toHaveBeenCalledWith(1, 'APPLE', {
    db,
    now: NOW,
  });

  expect(db.appSubscription.upsert).toHaveBeenCalledWith(
    expect.objectContaining({
      where: {
        provider_providerSubscriptionKey: {
          provider: 'APPLE',
          providerSubscriptionKey: '2000001234567000',
        },
      },

      create: expect.objectContaining({
        userId: 1,
        provider: 'APPLE',
        productId: 'plus.monthly',
        plan: 'PLUS',
        status: 'ACTIVE',
        grantsAccess: true,
        autoRenewEnabled: null,
        basePlanId: 'monthly',
      }),
    })
  );

  expect(result).toMatchObject({
    grantsAccess: true,
    status: 'ACTIVE',
    alreadyLinked: false,

    user: {
      plan: 'PLUS',
      subscriptionStatus: 'ACTIVE',
      billingProvider: 'APPLE',
    },
  });
});

test('updates an Apple subscription already linked to the same user', async () => {
  const db = makeDb({
    id: 'apple-subscription-1',
    userId: 1,
    customerReference: null,
  });

  const result = await verifyAndApplyAppleSubscription({
    userId: 1,
    signedTransactionInfo: 'signed-apple-jws',
    db,
    now: NOW,

    verifyTransaction: jest.fn().mockResolvedValue(makeTransaction()),
  });

  expect(result.alreadyLinked).toBe(true);

  expect(db.appSubscription.upsert).toHaveBeenCalledTimes(1);
});

test('rejects a subscription linked to another Chatforia user', async () => {
  const db = makeDb({
    id: 'apple-subscription-1',
    userId: 2,
    customerReference: null,
  });

  await expect(
    verifyAndApplyAppleSubscription({
      userId: 1,
      signedTransactionInfo: 'signed-apple-jws',
      db,
      now: NOW,

      verifyTransaction: jest.fn().mockResolvedValue(makeTransaction()),
    })
  ).rejects.toMatchObject({
    code: 'APPLE_SUBSCRIPTION_ALREADY_LINKED',
    statusCode: 409,
  });

  expect(assertProviderAvailableMock).not.toHaveBeenCalled();

  expect(db.appSubscription.upsert).not.toHaveBeenCalled();
});

test('stores an expired Apple subscription without granting access', async () => {
  const db = makeDb();

  recomputeEntitlementMock.mockResolvedValue({
    user: {
      id: 1,
      plan: 'FREE',
      subscriptionStatus: 'INACTIVE',
      subscriptionEndsAt: null,
      billingProvider: null,
      billingSubscriptionId: null,
    },

    selectedEntitlement: null,
  });

  const result = await verifyAndApplyAppleSubscription({
    userId: 1,
    signedTransactionInfo: 'signed-apple-jws',
    db,
    now: NOW,

    verifyTransaction: jest.fn().mockResolvedValue(
      makeTransaction({
        expiresDate: NOW.getTime() - 1,
      })
    ),
  });

  expect(db.appSubscription.upsert).toHaveBeenCalledWith(
    expect.objectContaining({
      create: expect.objectContaining({
        status: 'EXPIRED',
        grantsAccess: false,
        autoRenewEnabled: null,
      }),
    })
  );

  expect(result).toMatchObject({
    grantsAccess: false,
    status: 'EXPIRED',
    user: {
      plan: 'FREE',
    },
  });
});

test('rejects an Apple transaction for another bundle', async () => {
  const db = makeDb();

  await expect(
    verifyAndApplyAppleSubscription({
      userId: 1,
      signedTransactionInfo: 'signed-apple-jws',
      db,
      now: NOW,

      verifyTransaction: jest.fn().mockResolvedValue(
        makeTransaction({
          bundleId: 'com.example.other-app',
        })
      ),
    })
  ).rejects.toMatchObject({
    code: 'APPLE_BUNDLE_ID_MISMATCH',
    statusCode: 400,
  });

  expect(db.appSubscription.findUnique).not.toHaveBeenCalled();

  expect(db.appSubscription.upsert).not.toHaveBeenCalled();
});
