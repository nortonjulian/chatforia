/**
 * @jest-environment node
 */
import { jest } from '@jest/globals';
import express from 'express';
import request from 'supertest';

process.env.NODE_ENV = 'test';
process.env.STRIPE_SECRET_KEY = 'sk_test_apple_sync';

let billingRouter;
let verifyAppleSubscriptionMock;

await jest.unstable_mockModule('../utils/prismaClient.js', () => {
  const prismaMock = {
    user: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },

    appSubscription: {
      findFirst: jest.fn(),
      updateMany: jest.fn(),
    },

    mobileDataPackPurchase: {
      findFirst: jest.fn(),
    },

    subscriber: {
      findFirst: jest.fn(),
    },

    $transaction: jest.fn(async (callback) => callback(prismaMock)),
  };

  return {
    __esModule: true,
    default: prismaMock,
  };
});

await jest.unstable_mockModule('../services/appEntitlementService.js', () => ({
  __esModule: true,

  assertAppSubscriptionProviderAvailable: jest.fn(),

  recomputeUserAppEntitlement: jest.fn(),
}));

await jest.unstable_mockModule(
  '../services/googlePlayEntitlementService.js',
  () => ({
    __esModule: true,

    verifyAndApplyGooglePlaySubscription: jest.fn(),
  })
);

await jest.unstable_mockModule('../services/appleEntitlementService.js', () => {
  verifyAppleSubscriptionMock = jest.fn();

  return {
    __esModule: true,

    verifyAndApplyAppleSubscription: verifyAppleSubscriptionMock,
  };
});

await jest.unstable_mockModule('stripe', () => {
  const stripeMock = {
    customers: {
      create: jest.fn(),
    },

    subscriptions: {
      retrieve: jest.fn(),
      cancel: jest.fn(),
    },

    checkout: {
      sessions: {
        create: jest.fn(),
        retrieve: jest.fn(),
      },
    },

    billingPortal: {
      sessions: {
        create: jest.fn(),
      },
    },
  };

  return {
    __esModule: true,
    default: jest.fn(() => stripeMock),
  };
});

({ default: billingRouter } = await import('../routes/billing.js'));

function buildApp({ authenticated = true } = {}) {
  const app = express();

  app.use(express.json());

  app.use('/billing', (req, _res, next) => {
    req.user = authenticated
      ? {
          id: 1,
          email: 'apple-user@test.com',
        }
      : null;

    next();
  });

  app.use('/billing', billingRouter);

  return app;
}

beforeEach(() => {
  jest.clearAllMocks();
  verifyAppleSubscriptionMock.mockReset();
});

test('POST /billing/ios-sync requires authentication', async () => {
  const app = buildApp({
    authenticated: false,
  });

  const response = await request(app).post('/billing/ios-sync').send({
    signedTransactionInfo: 'signed-jws',
  });

  expect(response.statusCode).toBe(401);

  expect(response.body).toEqual({
    ok: false,
    error: 'Unauthorized',
    code: 'UNAUTHORIZED',
  });

  expect(verifyAppleSubscriptionMock).not.toHaveBeenCalled();
});

test('POST /billing/ios-sync requires a signed transaction', async () => {
  const app = buildApp();

  const response = await request(app).post('/billing/ios-sync').send({});

  expect(response.statusCode).toBe(400);

  expect(response.body).toEqual({
    ok: false,
    error: 'A signed Apple transaction is required.',
    code: 'APPLE_TRANSACTION_REQUIRED',
  });

  expect(verifyAppleSubscriptionMock).not.toHaveBeenCalled();
});

test('POST /billing/ios-sync returns the synchronized Apple entitlement', async () => {
  const app = buildApp();

  const expiresAt = new Date('2026-07-17T23:00:00.000Z');

  verifyAppleSubscriptionMock.mockResolvedValue({
    user: {
      id: 1,
      plan: 'PLUS',
      subscriptionStatus: 'ACTIVE',
      subscriptionEndsAt: expiresAt,
      billingProvider: 'APPLE',
      billingSubscriptionId: '2000001234567000',
    },

    transaction: {
      productId: 'plus.monthly',
    },

    grantsAccess: true,
    alreadyLinked: false,
  });

  const response = await request(app).post('/billing/ios-sync').send({
    signedTransactionInfo: 'signed-jws',
    source: 'ios_storekit2',
  });

  expect(response.statusCode).toBe(200);

  expect(verifyAppleSubscriptionMock).toHaveBeenCalledWith({
    userId: 1,
    signedTransactionInfo: 'signed-jws',
  });

  expect(response.body).toEqual({
    ok: true,
    provider: 'APPLE',
    plan: 'PLUS',
    status: 'ACTIVE',
    expiresAt: expiresAt.toISOString(),
    productId: 'plus.monthly',
    grantsAccess: true,
    alreadyLinked: false,
  });
});

test('POST /billing/ios-sync preserves service errors', async () => {
  const app = buildApp();

  const error = new Error(
    'This Apple subscription is already linked to another Chatforia account.'
  );

  error.statusCode = 409;
  error.code = 'APPLE_SUBSCRIPTION_ALREADY_LINKED';

  verifyAppleSubscriptionMock.mockRejectedValue(error);

  const consoleError = jest
    .spyOn(console, 'error')
    .mockImplementation(() => {});

  const response = await request(app).post('/billing/ios-sync').send({
    signedTransactionInfo: 'signed-jws',
  });

  consoleError.mockRestore();

  expect(response.statusCode).toBe(409);

  expect(response.body).toEqual({
    ok: false,
    error:
      'This Apple subscription is already linked to another Chatforia account.',
    code: 'APPLE_SUBSCRIPTION_ALREADY_LINKED',
  });
});
