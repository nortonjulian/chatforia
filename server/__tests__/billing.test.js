/**
 * @jest-environment node
 */
import { jest } from '@jest/globals';
import express from 'express';
import request from 'supertest';

let prismaMock;
let stripeMock;
let billingRouter;
let recomputeUserAppEntitlementMock;
let getEffectiveAppEntitlementMock;
let assertAppSubscriptionProviderAvailableMock;
let verifyAndApplyGooglePlaySubscriptionMock;

await jest.unstable_mockModule(
  '../services/googlePlayEntitlementService.js',
  () => {
    verifyAndApplyGooglePlaySubscriptionMock =
      jest.fn();

    return {
      __esModule: true,
      verifyAndApplyGooglePlaySubscription:
        verifyAndApplyGooglePlaySubscriptionMock,
    };
  }
);

beforeAll(async () => {
  process.env.NODE_ENV = 'test';
  process.env.STRIPE_SECRET_KEY = 'sk_test_123';
  process.env.WEB_URL = 'https://app.test';
  process.env.STRIPE_PRICE_PLUS_MONTHLY = 'price_plus';
  process.env.STRIPE_PRICE_PREMIUM_MONTHLY = 'price_prem_m';
  process.env.STRIPE_PRICE_PREMIUM_ANNUAL = 'price_prem_a';
  process.env.STRIPE_PRICE_ESIM_LOCAL_5 = 'price_esim_local_5';

  await jest.unstable_mockModule(
    '../utils/prismaClient.js',
    () => {
      prismaMock = {
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

        $transaction: jest.fn(
          async (callback) =>
            callback(prismaMock)
        ),
      };

      return {
        __esModule: true,
        default: prismaMock,
      };
    }
  );

  await jest.unstable_mockModule(
    '../services/appEntitlementService.js',
    () => {
      recomputeUserAppEntitlementMock =
        jest.fn();

      getEffectiveAppEntitlementMock =
        jest.fn();

      assertAppSubscriptionProviderAvailableMock =
        jest.fn();

      return {
        __esModule: true,

        recomputeUserAppEntitlement:
          recomputeUserAppEntitlementMock,

        getEffectiveAppEntitlement:
          getEffectiveAppEntitlementMock,

        assertAppSubscriptionProviderAvailable:
          assertAppSubscriptionProviderAvailableMock,
      };
    }
  );

  await jest.unstable_mockModule(
    'stripe',
    () => {
      stripeMock = {
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

      const StripeCtor =
        jest.fn(() => stripeMock);

      return {
        __esModule: true,
        default: StripeCtor,
      };
    }
  );

  await jest.unstable_mockModule(
    '../services/googlePlayEntitlementService.js',
    () => {
      verifyAndApplyGooglePlaySubscriptionMock =
        jest.fn();

      return {
        __esModule: true,
        verifyAndApplyGooglePlaySubscription:
          verifyAndApplyGooglePlaySubscriptionMock,
      };
    }
  );

  ({ default: billingRouter } =
    await import('../routes/billing.js'));
});

beforeEach(() => {
  jest.clearAllMocks();

  assertAppSubscriptionProviderAvailableMock
    .mockReset()
    .mockResolvedValue(null);

  recomputeUserAppEntitlementMock
    .mockReset();

  getEffectiveAppEntitlementMock
    .mockReset()
    .mockResolvedValue(null);

  verifyAndApplyGooglePlaySubscriptionMock
  .mockReset();
});

function buildApp(userOverride = {}) {
  const app = express();

  app.use(express.json());

  app.use('/billing', (req, _res, next) => {
    req.user = {
      id: 1,
      email: 'user@test.com',
      billingCustomerId: 'cus_123',
      billingSubscriptionId: 'sub_123',
      ...userOverride,
    };

    next();
  });

  app.use('/billing', billingRouter);

  return app;
}

function buildUnauthedApp() {
  const app = express();

  app.use(express.json());

  app.use('/billing', (req, _res, next) => {
    req.user = null;
    next();
  });

  app.use('/billing', billingRouter);

  return app;
}

describe('GET /billing/my-plan', () => {
  test('returns FREE plan when no user is authenticated', async () => {
    const app = buildUnauthedApp();

    const res = await request(app).get('/billing/my-plan');

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({
      plan: {
        id: null,
        code: 'FREE',
        label: 'Chatforia Free',
        isFree: true,
        status: 'INACTIVE',
        renewsAt: null,
        autoRenewEnabled: false,
        provider: null,
      },
    });
  });

  test('returns current user plan from DB', async () => {
    const app = buildApp();

    const renewsAt = new Date('2026-01-01T00:00:00.000Z');

    getEffectiveAppEntitlementMock.mockResolvedValue({
      autoRenewEnabled: true,
    });

    prismaMock.user.findUnique.mockResolvedValue({
      plan: 'PREMIUM',
      subscriptionStatus: 'ACTIVE',
      subscriptionEndsAt: renewsAt,
      billingProvider: 'STRIPE',
      billingSubscriptionId: 'sub_123',
    });

    const res = await request(app).get('/billing/my-plan');

    expect(res.statusCode).toBe(200);

    expect(prismaMock.user.findUnique).toHaveBeenCalledWith({
      where: { id: 1 },
      select: {
        plan: true,
        subscriptionStatus: true,
        subscriptionEndsAt: true,
        billingProvider: true,
      },
    });

    expect(res.body).toEqual({
      plan: {
        id: 'PREMIUM',
        code: 'PREMIUM',
        label: 'Chatforia Premium',
        isFree: false,
        status: 'ACTIVE',
        renewsAt: renewsAt.toISOString(),
        autoRenewEnabled: true,
        provider: 'STRIPE',
      },
    });
  });
});

describe('GET /billing/checkout-status', () => {
  const paidEsimSession = {
    id: 'cs_test_esim_123',
    mode: 'payment',
    status: 'complete',
    payment_status: 'paid',
    payment_intent:
      'pi_test_esim_123',
    client_reference_id: '1',
    metadata: {
      userId: '1',
      product:
        'chatforia_esim_local_5',
      addonKind:
        'chatforia_esim_local_5_premium',
      addonType: 'ESIM',
      platform: 'ios',
    },
  };

  test('returns 401 when no user is authenticated', async () => {
    const app = buildUnauthedApp();

    const res = await request(app)
      .get(
        '/billing/checkout-status?session_id=cs_test_esim_123'
      );

    expect(res.statusCode).toBe(401);

    expect(res.body).toEqual({
      error: 'Unauthorized',
    });
  });

  test('returns 400 when session_id is missing', async () => {
    const app = buildApp();

    const res = await request(app)
      .get('/billing/checkout-status');

    expect(res.statusCode).toBe(400);

    expect(res.body).toEqual({
      error: 'session_id is required',
    });
  });

  test('blocks a checkout session belonging to another user', async () => {
    const app = buildApp();

    stripeMock.checkout.sessions.retrieve
      .mockResolvedValue({
        ...paidEsimSession,
        client_reference_id: '2',
        metadata: {
          ...paidEsimSession.metadata,
          userId: '2',
        },
      });

    const res = await request(app)
      .get(
        '/billing/checkout-status?session_id=cs_test_esim_123'
      );

    expect(res.statusCode).toBe(403);

    expect(res.body).toEqual({
      error:
        'This checkout session does not belong to the authenticated user',
    });
  });

  test('returns PENDING while the webhook has not created the purchase', async () => {
    const app = buildApp();

    stripeMock.checkout.sessions.retrieve
      .mockResolvedValue(
        paidEsimSession
      );

    prismaMock.mobileDataPackPurchase
      .findFirst
      .mockResolvedValue(null);

    const res = await request(app)
      .get(
        '/billing/checkout-status?session_id=cs_test_esim_123'
      );

    expect(res.statusCode).toBe(200);

    expect(
      prismaMock.mobileDataPackPurchase
        .findFirst
    ).toHaveBeenCalledWith({
      where: {
        userId: 1,
        billingTransactionId:
          'pi_test_esim_123',
      },
      select: {
        id: true,
        addonKind: true,
        totalDataMb: true,
        remainingDataMb: true,
        expiresAt: true,
        esimProfileId: true,
      },
    });

    expect(res.body).toEqual({
      status: 'PENDING',
      complete: false,
      paid: true,
      provisioned: false,
      sessionId:
        'cs_test_esim_123',
      paymentStatus: 'paid',
      sessionStatus: 'complete',
      purchase: null,
    });
  });

  test('returns COMPLETE after the webhook links the purchase and subscriber', async () => {
    const app = buildApp();

    const expiresAt =
      new Date(
        '2026-08-15T00:00:00.000Z'
      );

    stripeMock.checkout.sessions.retrieve
      .mockResolvedValue(
        paidEsimSession
      );

    prismaMock.mobileDataPackPurchase
      .findFirst
      .mockResolvedValue({
        id: 22,
        addonKind:
          'chatforia_esim_local_5_premium',
        totalDataMb: 8192,
        remainingDataMb: 8192,
        expiresAt,
        esimProfileId:
          'mock-telna-profile',
      });

    prismaMock.subscriber.findFirst
      .mockResolvedValue({
        id: 7,
        status: 'ACTIVE',
        providerProfileId:
          'mock-telna-profile',
        providerMeta: {
          stripeSessionId:
            'cs_test_esim_123',
        },
      });

    const res = await request(app)
      .get(
        '/billing/checkout-status?session_id=cs_test_esim_123'
      );

    expect(res.statusCode).toBe(200);

    expect(
      prismaMock.subscriber.findFirst
    ).toHaveBeenCalledWith({
      where: {
        userId: 1,
        purchaseId: 22,
      },
      orderBy: [
        {
          activatedAt: 'desc',
        },
        {
          createdAt: 'desc',
        },
      ],
      select: {
        id: true,
        status: true,
        providerProfileId: true,
        providerMeta: true,
      },
    });

    expect(res.body).toEqual({
      status: 'COMPLETE',
      complete: true,
      paid: true,
      provisioned: true,
      sessionId:
        'cs_test_esim_123',
      paymentStatus: 'paid',
      sessionStatus: 'complete',
      purchase: {
        id: 22,
        addonKind:
          'chatforia_esim_local_5_premium',
        totalDataMb: 8192,
        remainingDataMb: 8192,
        expiresAt:
          expiresAt.toISOString(),
      },
    });
  });
});

describe('POST /billing/checkout', () => {
  test('returns 401 when no user', async () => {
    const app = buildUnauthedApp();

    const res = await request(app).post('/billing/checkout').send({});

    expect(res.statusCode).toBe(401);
    expect(res.body).toEqual({
      error: 'Unauthorized',
    });
  });

  test('creates checkout session for PLUS_MONTHLY using existing billing customer', async () => {
    const app = buildApp();

    prismaMock.user.findUnique.mockResolvedValue({
      id: 1,
      email: 'user@test.com',
      username: 'julian',
      billingCustomerId: 'cus_123',
      billingSubscriptionId: null,
    });

    stripeMock.checkout.sessions.create.mockResolvedValue({
      id: 'cs_123',
      url: 'https://stripe.test/checkout/cs_123',
    });

    const res = await request(app)
      .post('/billing/checkout')
      .send({ plan: 'PLUS_MONTHLY' });

    expect(res.statusCode).toBe(200);

    expect(
      assertAppSubscriptionProviderAvailableMock
    ).toHaveBeenCalledWith(
      1,
      'STRIPE'
    );

    expect(prismaMock.user.findUnique).toHaveBeenCalledWith({
      where: { id: 1 },
      select: {
        id: true,
        email: true,
        username: true,
        plan: true,
        billingProvider: true,
        billingCustomerId: true,
        billingSubscriptionId: true,
        subscriptionStatus: true,
        subscriptionEndsAt: true,
      },
    });

    expect(stripeMock.checkout.sessions.create).toHaveBeenCalledWith({
      mode: 'subscription',
      customer: 'cus_123',
      client_reference_id: '1',
      line_items: [
        {
          price: 'price_plus',
          quantity: 1,
        },
      ],
      allow_promotion_codes: true,
      automatic_tax: { enabled: true },
      billing_address_collection: 'auto',
      customer_update: {
        address: 'auto',
        name: 'auto',
      },
      metadata: {
        userId: '1',
        plan: 'PLUS_MONTHLY',
        platform: 'web',
        product: '',
        addonKind: '',
        addonType: '',
        checkoutType: 'subscription',
      },
      subscription_data: {
        metadata: {
          userId: '1',
          plan: 'PLUS_MONTHLY',
        },
      },
      success_url:
        'https://app.test/upgrade-success?session_id={CHECKOUT_SESSION_ID}',
      cancel_url: 'https://app.test/upgrade?canceled=1',
    });

    expect(res.body).toEqual({
      url: 'https://stripe.test/checkout/cs_123',
      checkoutUrl: 'https://stripe.test/checkout/cs_123',
      sessionId: 'cs_123',
      plan: 'PLUS_MONTHLY',
    });
  });

  test('creates Stripe customer when user has no billingCustomerId', async () => {
    const app = buildApp();

    prismaMock.user.findUnique.mockResolvedValue({
      id: 1,
      email: 'user@test.com',
      username: 'julian',
      billingCustomerId: null,
      billingSubscriptionId: null,
    });

    stripeMock.customers.create.mockResolvedValue({
      id: 'cus_new',
    });

    stripeMock.checkout.sessions.create.mockResolvedValue({
      id: 'cs_new',
      url: 'https://stripe.test/checkout/cs_new',
    });

    const res = await request(app)
      .post('/billing/checkout')
      .send({ plan: 'PREMIUM_MONTHLY' });

    expect(res.statusCode).toBe(200);

    expect(stripeMock.customers.create).toHaveBeenCalledWith({
      email: 'user@test.com',
      name: 'julian',
      metadata: {
        userId: '1',
        app: 'chatforia',
      },
    });

    expect(prismaMock.user.update).toHaveBeenCalledWith({
      where: { id: 1 },
      data: {
        billingCustomerId: 'cus_new',
      },
    });

    expect(stripeMock.checkout.sessions.create).toHaveBeenCalledWith(
      expect.objectContaining({
        customer: 'cus_new',
        line_items: [
          {
            price: 'price_prem_m',
            quantity: 1,
          },
        ],
        metadata: {
          userId: '1',
          plan: 'PREMIUM_MONTHLY',
          platform: 'web',
          product: '',
          addonKind: '',
          addonType: '',
          checkoutType: 'subscription',
        },
      })
    );

    expect(res.body).toEqual({
      url: 'https://stripe.test/checkout/cs_new',
      checkoutUrl: 'https://stripe.test/checkout/cs_new',
      sessionId: 'cs_new',
      plan: 'PREMIUM_MONTHLY',
    });
  });

  test('returns 400 when plan is missing or unconfigured', async () => {
    const app = buildApp();

    const res = await request(app).post('/billing/checkout').send({});

    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({
      error:
        'Checkout must be for a known subscription or add-on product',
    });
  });

  test('blocks web Stripe checkout when another app provider is active', async () => {
  const app = buildApp();

  prismaMock.user.findUnique.mockResolvedValue({
    id: 1,
    email: 'user@test.com',
    username: 'julian',

    // Intentionally stale user projection.
    plan: 'FREE',
    billingProvider: null,

    billingCustomerId: 'cus_123',
    billingSubscriptionId: null,
    subscriptionStatus: 'INACTIVE',
    subscriptionEndsAt: null,
  });

  const conflictEndsAt =
    new Date('2026-08-01T00:00:00.000Z');

  const conflict =
    new Error(
      'This Chatforia app subscription is already managed through GOOGLE_PLAY.'
    );

  conflict.statusCode = 409;
  conflict.code =
    'APP_SUBSCRIPTION_PROVIDER_CONFLICT';
  conflict.currentProvider =
    'GOOGLE_PLAY';
  conflict.requestedProvider =
    'STRIPE';
  conflict.currentPlan =
    'PLUS';
  conflict.currentSubscriptionEndsAt =
    conflictEndsAt;

  assertAppSubscriptionProviderAvailableMock
    .mockRejectedValueOnce(conflict);

  const res = await request(app)
    .post('/billing/checkout')
    .send({
      plan: 'PLUS_MONTHLY',
      platform: 'web',
    });

  expect(res.statusCode).toBe(409);

  expect(res.body).toEqual({
    error:
      'This Chatforia app subscription is already managed through GOOGLE_PLAY.',

    code:
      'APP_SUBSCRIPTION_PROVIDER_CONFLICT',

    currentProvider:
      'GOOGLE_PLAY',

    requestedProvider:
      'STRIPE',

    currentPlan:
      'PLUS',

    currentSubscriptionEndsAt:
      conflictEndsAt.toISOString(),

    provider:
      'GOOGLE_PLAY',

    managedExternally:
      true,

    managementAction:
      'OPEN_GOOGLE_PLAY_SUBSCRIPTIONS',

    message:
      'Manage this subscription through Google Play.',
  });

  expect(
    stripeMock.checkout.sessions.create
  ).not.toHaveBeenCalled();
});

  test('blocks Stripe app checkout from Android', async () => {
    const app = buildApp();

    prismaMock.user.findUnique.mockResolvedValue({
      id: 1,
      email: 'user@test.com',
      username: 'julian',
      plan: 'FREE',
      billingProvider: null,
      billingCustomerId: 'cus_123',
      billingSubscriptionId: null,
      subscriptionStatus: 'INACTIVE',
      subscriptionEndsAt: null,
    });

    const res = await request(app)
      .post('/billing/checkout')
      .send({
        plan: 'PLUS_MONTHLY',
        platform: 'android',
      });

    expect(res.statusCode).toBe(409);

    expect(res.body).toEqual({
      error:
        'Android app subscriptions must be purchased through Google Play.',
      code: 'USE_GOOGLE_PLAY',
      provider: 'GOOGLE_PLAY',
    });

    expect(
      assertAppSubscriptionProviderAvailableMock
    ).not.toHaveBeenCalled();

    expect(
      stripeMock.checkout.sessions.create
    ).not.toHaveBeenCalled();
  });

  test('blocks Stripe app checkout from iOS', async () => {
  const app = buildApp();

  prismaMock.user.findUnique.mockResolvedValue({
    id: 1,
    email: 'user@test.com',
    username: 'julian',
    plan: 'FREE',
    billingProvider: null,
    billingCustomerId: 'cus_123',
    billingSubscriptionId: null,
    subscriptionStatus: 'INACTIVE',
    subscriptionEndsAt: null,
  });

  const res = await request(app)
    .post('/billing/checkout')
    .send({
      plan: 'PREMIUM_MONTHLY',
      platform: 'ios',
    });

  expect(res.statusCode).toBe(409);

  expect(res.body).toEqual({
    error:
      'iOS app subscriptions must be purchased through the App Store.',
    code: 'USE_APPLE',
    provider: 'APPLE',
  });

  expect(
    assertAppSubscriptionProviderAvailableMock
  ).not.toHaveBeenCalled();

  expect(
    stripeMock.checkout.sessions.create
  ).not.toHaveBeenCalled();
});

  test(
    'creates iOS eSIM checkout with mobile return URLs',
    async () => {
      const app = buildApp();

      prismaMock.user.findUnique.mockResolvedValue({
        id: 1,
        email: 'user@test.com',
        username: 'julian',
        plan: 'FREE',
        billingProvider: null,
        billingCustomerId: 'cus_123',
        billingSubscriptionId: null,
        subscriptionStatus: 'INACTIVE',
        subscriptionEndsAt: null,
      });

      stripeMock.checkout.sessions.create.mockResolvedValue({
        id: 'cs_esim_ios_123',
        url: 'https://stripe.test/checkout/cs_esim_ios_123',
      });

      const res = await request(app)
        .post('/billing/checkout')
        .send({
          product: 'chatforia_esim_local_5',
          platform: 'ios',
        });

      expect(res.statusCode).toBe(200);

      expect(
        stripeMock.checkout.sessions.create
      ).toHaveBeenCalledWith(
        expect.objectContaining({
          mode: 'payment',

          line_items: [
            {
              price: 'price_esim_local_5',
              quantity: 1,
            },
          ],

          metadata: expect.objectContaining({
            userId: '1',
            product: 'chatforia_esim_local_5',
            addonKind:
              'chatforia_esim_local_5_premium',
            addonType: 'ESIM',
            checkoutType: 'payment',
            platform: 'ios',
          }),

          success_url:
            'https://app.test/mobile/esim/checkout-complete?session_id={CHECKOUT_SESSION_ID}',

          cancel_url:
            'https://app.test/mobile/esim/checkout-canceled',
        })
      );

      expect(res.body).toEqual(
        expect.objectContaining({
          checkoutUrl:
            'https://stripe.test/checkout/cs_esim_ios_123',
          sessionId: 'cs_esim_ios_123',
        })
      );
    }
  );

    test(
      'creates Android eSIM checkout with a Stripe idempotency key',
      async () => {
        const app = buildApp();

        prismaMock.user.findUnique.mockResolvedValue({
          id: 1,
          email: 'user@test.com',
          username: 'julian',
          plan: 'FREE',
          billingProvider: null,
          billingCustomerId: 'cus_123',
          billingSubscriptionId: null,
          subscriptionStatus: 'INACTIVE',
          subscriptionEndsAt: null,
        });

        stripeMock.checkout.sessions.create.mockResolvedValue({
          id: 'cs_esim_android_123',
          url:
            'https://stripe.test/checkout/cs_esim_android_123',
        });

        const checkoutAttemptId =
          'attempt_android_12345678';

        const res = await request(app)
          .post('/billing/checkout')
          .send({
            product: 'chatforia_esim_local_5',
            platform: 'android',
            checkoutAttemptId,
          });

        expect(res.statusCode).toBe(200);

        expect(
          stripeMock.checkout.sessions.create
        ).toHaveBeenCalledWith(
          expect.objectContaining({
            mode: 'payment',

            customer: 'cus_123',

            client_reference_id: '1',

            line_items: [
              {
                price: 'price_esim_local_5',
                quantity: 1,
              },
            ],

            metadata: expect.objectContaining({
              userId: '1',
              product:
                'chatforia_esim_local_5',
              addonKind:
                'chatforia_esim_local_5_premium',
              addonType: 'ESIM',
              checkoutType: 'payment',
              platform: 'android',
              checkoutAttemptId,
            }),

            payment_intent_data: {
              metadata: expect.objectContaining({
                userId: '1',
                product:
                  'chatforia_esim_local_5',
                addonKind:
                  'chatforia_esim_local_5_premium',
                addonType: 'ESIM',
                checkoutType: 'payment',
                platform: 'android',
                checkoutAttemptId,
              }),
            },

            success_url:
              'https://app.test/mobile/esim/checkout-complete?session_id={CHECKOUT_SESSION_ID}',

            cancel_url:
              'https://app.test/mobile/esim/checkout-canceled',
          }),
          {
            idempotencyKey:
              'chatforia-checkout:1:android:chatforia_esim_local_5_premium:attempt_android_12345678',
          }
        );

        expect(res.body).toEqual({
          url:
            'https://stripe.test/checkout/cs_esim_android_123',
          checkoutUrl:
            'https://stripe.test/checkout/cs_esim_android_123',
          sessionId:
            'cs_esim_android_123',
          plan: '',
        });
      }
    );

  test(
    'uses the same Stripe idempotency key for repeated Android checkout requests',
    async () => {
      const app = buildApp();

      prismaMock.user.findUnique.mockResolvedValue({
        id: 1,
        email: 'user@test.com',
        username: 'julian',
        plan: 'FREE',
        billingProvider: null,
        billingCustomerId: 'cus_123',
        billingSubscriptionId: null,
        subscriptionStatus: 'INACTIVE',
        subscriptionEndsAt: null,
      });

      stripeMock.checkout.sessions.create.mockResolvedValue({
        id: 'cs_esim_same_attempt',
        url:
          'https://stripe.test/checkout/cs_esim_same_attempt',
      });

      const requestBody = {
        product: 'chatforia_esim_local_5',
        platform: 'android',
        checkoutAttemptId:
          'same_attempt_12345678',
      };

      const firstResponse = await request(app)
        .post('/billing/checkout')
        .send(requestBody);

      const secondResponse = await request(app)
        .post('/billing/checkout')
        .send(requestBody);

      expect(firstResponse.statusCode).toBe(200);
      expect(secondResponse.statusCode).toBe(200);

      expect(
        stripeMock.checkout.sessions.create
      ).toHaveBeenCalledTimes(2);

      const firstStripeOptions =
        stripeMock.checkout.sessions.create
          .mock.calls[0][1];

      const secondStripeOptions =
        stripeMock.checkout.sessions.create
          .mock.calls[1][1];

      expect(firstStripeOptions).toEqual({
        idempotencyKey:
          'chatforia-checkout:1:android:chatforia_esim_local_5_premium:same_attempt_12345678',
      });

      expect(secondStripeOptions).toEqual(
        firstStripeOptions
      );

      expect(firstResponse.body.sessionId).toBe(
        'cs_esim_same_attempt'
      );

      expect(secondResponse.body.sessionId).toBe(
        'cs_esim_same_attempt'
      );
    }
  );

  test(
    'allows legacy Android eSIM checkout without a checkout attempt ID',
    async () => {
      const app = buildApp();

      prismaMock.user.findUnique.mockResolvedValue({
        id: 1,
        email: 'user@test.com',
        username: 'julian',
        plan: 'FREE',
        billingProvider: null,
        billingCustomerId: 'cus_123',
        billingSubscriptionId: null,
        subscriptionStatus: 'INACTIVE',
        subscriptionEndsAt: null,
      });

      stripeMock.checkout.sessions.create.mockResolvedValue({
        id: 'cs_esim_android_legacy',
        url:
          'https://stripe.test/checkout/cs_esim_android_legacy',
      });

      const res = await request(app)
        .post('/billing/checkout')
        .send({
          product: 'chatforia_esim_local_5',
          platform: 'android',
        });

      expect(res.statusCode).toBe(200);

      expect(
        stripeMock.checkout.sessions.create
      ).toHaveBeenCalledTimes(1);

      expect(
        stripeMock.checkout.sessions.create
          .mock.calls[0]
      ).toHaveLength(1);

      expect(
        stripeMock.checkout.sessions.create
          .mock.calls[0][0]
      ).toEqual(
        expect.objectContaining({
          metadata: expect.not.objectContaining({
            checkoutAttemptId:
              expect.anything(),
          }),
        })
      );
    }
  );

  test(
    'rejects an invalid checkout attempt ID before creating a Stripe session',
    async () => {
      const app = buildApp();

      const res = await request(app)
        .post('/billing/checkout')
        .send({
          product: 'chatforia_esim_local_5',
          platform: 'android',
          checkoutAttemptId: 'bad id!',
        });

      expect(res.statusCode).toBe(400);

      expect(res.body).toEqual({
        error: 'Invalid checkoutAttemptId',
        code:
          'INVALID_CHECKOUT_ATTEMPT_ID',
      });

      expect(
        prismaMock.user.findUnique
      ).not.toHaveBeenCalled();

      expect(
        stripeMock.checkout.sessions.create
      ).not.toHaveBeenCalled();
    }
  );

  test('returns 404 when user is not found', async () => {
    const app = buildApp();

    prismaMock.user.findUnique.mockResolvedValue(null);

    const res = await request(app)
      .post('/billing/checkout')
      .send({ plan: 'PLUS_MONTHLY' });

    expect(res.statusCode).toBe(404);
    expect(res.body).toEqual({ error: 'User not found' });
  });
});

describe('POST /billing/portal', () => {
  test('returns 401 when no user', async () => {
    const app = buildUnauthedApp();

    const res = await request(app).post('/billing/portal').send({});

    expect(res.statusCode).toBe(401);
    expect(res.body).toEqual({
      error: 'Unauthorized',
      code: 'UNAUTHORIZED',
    });
  });

  test('returns 400 when user has no billing customer', async () => {
    const app = buildApp();

    prismaMock.user.findUnique.mockResolvedValue({
      id: 1,
      plan: 'FREE',
      billingProvider: null,
      billingCustomerId: null,
      billingSubscriptionId: null,
    });

    const res = await request(app).post('/billing/portal').send({});

    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({
      error: 'No Stripe app subscription was found.',
      code: 'NO_STRIPE_SUBSCRIPTION',
    });
  });

  test('creates billing portal session', async () => {
    const app = buildApp();

    prismaMock.user.findUnique.mockResolvedValue({
      id: 1,
      plan: 'PLUS',
      billingProvider: 'STRIPE',
      billingCustomerId: 'cus_123',
      billingSubscriptionId: 'sub_123',
    });

    stripeMock.billingPortal.sessions.create.mockResolvedValue({
      id: 'bps_123',
      url: 'https://stripe.test/portal/bps_123',
    });

    const res = await request(app).post('/billing/portal').send({});

    expect(res.statusCode).toBe(200);

    expect(prismaMock.user.findUnique).toHaveBeenCalledWith({
      where: { id: 1 },
      select: {
        id: true,
        plan: true,
        billingProvider: true,
        billingCustomerId: true,
        billingSubscriptionId: true,
      },
    });

    expect(stripeMock.billingPortal.sessions.create).toHaveBeenCalledWith({
      customer: 'cus_123',
      return_url: 'https://app.test/account/plan',
    });

    expect(res.body).toEqual({
      url: 'https://stripe.test/portal/bps_123',
      portalUrl: 'https://stripe.test/portal/bps_123',
      provider: 'STRIPE',
      managedExternally: false,
      managementAction: 'OPEN_STRIPE_PORTAL',
    });
  });
});

describe(
  'POST /billing/google-play/verify provider migration',
  () => {
    test(
      'explicit restore migrates Stripe app subscription to Google Play',
      async () => {
        const app = buildApp();

        const expiryTime =
          new Date(
            '2026-08-15T00:00:00.000Z'
          );

        const conflict =
          new Error(
            'This Chatforia app subscription is already managed through STRIPE.'
          );

        conflict.statusCode = 409;
        conflict.code =
          'APP_SUBSCRIPTION_PROVIDER_CONFLICT';
        conflict.currentProvider =
          'STRIPE';

        verifyAndApplyGooglePlaySubscriptionMock
          .mockRejectedValueOnce(
            conflict
          )
          .mockResolvedValueOnce({
            user: {
              plan: 'PLUS',
            },

            verified: {
              entitlementPlan:
                'PLUS',

              subscriptionState:
                'SUBSCRIPTION_STATE_ACTIVE',

              expiryTime,

              productId:
                'chatforia_plus',

              basePlanId:
                'monthly',

              autoRenewEnabled:
                true,

              grantsAccess:
                true,
            },

            acknowledged:
              true,

            acknowledgementPending:
              false,
          });

        prismaMock.appSubscription.findFirst
          .mockResolvedValue({
            providerSubscriptionKey:
              'sub_123',
          });

        stripeMock.subscriptions.cancel
          .mockResolvedValue({
            id: 'sub_123',
            status: 'canceled',
            livemode: false,
          });

        prismaMock.appSubscription.updateMany
          .mockResolvedValue({
            count: 1,
          });

        recomputeUserAppEntitlementMock
          .mockResolvedValue({
            user: {
              id: 1,
              plan: 'FREE',
              subscriptionStatus:
                'INACTIVE',
              subscriptionEndsAt:
                null,
              billingProvider:
                null,
              billingSubscriptionId:
                null,
            },
          });

        const res =
          await request(app)
            .post(
              '/billing/google-play/verify'
            )
            .send({
              purchaseToken:
                'google-token-123',

              allowProviderMigration:
                true,
            });

        expect(res.statusCode)
          .toBe(200);

        expect(
          verifyAndApplyGooglePlaySubscriptionMock
        ).toHaveBeenCalledTimes(2);

        expect(
          stripeMock.subscriptions.cancel
        ).toHaveBeenCalledWith(
          'sub_123'
        );

        expect(
          prismaMock.appSubscription.updateMany
        ).toHaveBeenCalledWith({
          where: {
            userId: 1,
            provider: 'STRIPE',
            providerSubscriptionKey:
              'sub_123',
          },

          data: {
            status: 'CANCELED',
            grantsAccess: false,
            autoRenewEnabled: false,
            endsAt:
              expect.any(Date),
            lastVerifiedAt:
              expect.any(Date),

            rawResponse: {
              source:
                'google-play-provider-migration',

              migratedTo:
                'GOOGLE_PLAY',

              livemode:
                false,
            },
          },
        });

        expect(res.body).toEqual({
          ok: true,
          plan: 'PLUS',
          entitlementPlan:
            'PLUS',

          status:
            'SUBSCRIPTION_STATE_ACTIVE',

          expiresAt:
            expiryTime.toISOString(),

          acknowledged:
            true,

          acknowledgementPending:
            false,

          productId:
            'chatforia_plus',

          basePlanId:
            'monthly',

          autoRenewEnabled:
            true,

          grantsAccess:
            true,
        });
      }
    );
  }
);

describe('POST /billing/provider-aware management', () => {
  test('returns Google Play management action instead of opening Stripe portal', async () => {
    const app = buildApp();

    prismaMock.user.findUnique.mockResolvedValue({
      id: 1,
      plan: 'PREMIUM',
      billingProvider: 'GOOGLE_PLAY',
      billingCustomerId: 'cus_123',
      billingSubscriptionId: null,
    });

    const res = await request(app)
      .post('/billing/portal')
      .send({});

    expect(res.statusCode).toBe(409);

    expect(res.body).toEqual({
      error:
        'This subscription is managed by another provider.',
      code: 'SUBSCRIPTION_MANAGED_BY_PROVIDER',
      provider: 'GOOGLE_PLAY',
      managedExternally: true,
      managementAction:
        'OPEN_GOOGLE_PLAY_SUBSCRIPTIONS',
      message:
        'Manage this subscription through Google Play.',
    });

    expect(
      stripeMock.billingPortal.sessions.create
    ).not.toHaveBeenCalled();
  });

  test('returns support action for a manual subscription portal request', async () => {
    const app = buildApp();

    prismaMock.user.findUnique.mockResolvedValue({
      id: 1,
      plan: 'PREMIUM',
      billingProvider: 'MANUAL',
      billingCustomerId: null,
      billingSubscriptionId: null,
    });

    const res = await request(app)
      .post('/billing/portal')
      .send({});

    expect(res.statusCode).toBe(409);

    expect(res.body).toEqual({
      error:
        'This subscription is managed by another provider.',
      code: 'SUBSCRIPTION_MANAGED_BY_PROVIDER',
      provider: 'MANUAL',
      managedExternally: true,
      managementAction: 'CONTACT_SUPPORT',
      message:
        'This subscription must be managed by Chatforia support.',
    });

    expect(
      stripeMock.billingPortal.sessions.create
    ).not.toHaveBeenCalled();
  });

  test('does not send a Google Play subscription to Stripe cancellation', async () => {
    const app = buildApp();

    prismaMock.user.findUnique.mockResolvedValue({
      id: 1,
      plan: 'PLUS',
      billingProvider: 'GOOGLE_PLAY',
      billingSubscriptionId: null,
    });

    const res = await request(app)
      .post('/billing/cancel-now')
      .send({});

    expect(res.statusCode).toBe(409);

    expect(res.body).toEqual({
      error:
        'This subscription must be canceled through its billing provider.',
      code: 'SUBSCRIPTION_MANAGED_BY_PROVIDER',
      provider: 'GOOGLE_PLAY',
      managedExternally: true,
      managementAction:
        'OPEN_GOOGLE_PLAY_SUBSCRIPTIONS',
      message:
        'Manage this subscription through Google Play.',
    });

    expect(
      stripeMock.subscriptions.cancel
    ).not.toHaveBeenCalled();

    expect(
      prismaMock.$transaction
    ).not.toHaveBeenCalled();
  });

  test('does not send a manual subscription to Stripe cancellation', async () => {
    const app = buildApp();

    prismaMock.user.findUnique.mockResolvedValue({
      id: 1,
      plan: 'PREMIUM',
      billingProvider: 'MANUAL',
      billingSubscriptionId: null,
    });

    const res = await request(app)
      .post('/billing/cancel-now')
      .send({});

    expect(res.statusCode).toBe(409);

    expect(res.body).toEqual({
      error:
        'This subscription must be canceled through its billing provider.',
      code: 'SUBSCRIPTION_MANAGED_BY_PROVIDER',
      provider: 'MANUAL',
      managedExternally: true,
      managementAction: 'CONTACT_SUPPORT',
      message:
        'This subscription must be managed by Chatforia support.',
    });

    expect(
      stripeMock.subscriptions.cancel
    ).not.toHaveBeenCalled();

    expect(
      prismaMock.$transaction
    ).not.toHaveBeenCalled();
  });

  test('cancels Stripe entitlement and recomputes the effective app plan', async () => {
    const app = buildApp();

    prismaMock.user.findUnique.mockResolvedValue({
      id: 1,
      plan: 'PLUS',
      billingProvider: 'STRIPE',
      billingSubscriptionId: 'sub_123',
    });

    stripeMock.subscriptions.cancel.mockResolvedValue({
      id: 'sub_123',
      status: 'canceled',
      livemode: false,
    });

    prismaMock.appSubscription.updateMany
      .mockResolvedValue({
        count: 1,
      });

    recomputeUserAppEntitlementMock
      .mockResolvedValue({
        user: {
          id: 1,
          plan: 'FREE',
          subscriptionStatus: 'INACTIVE',
          subscriptionEndsAt: null,
          billingProvider: null,
          billingSubscriptionId: null,
        },
      });

    const res = await request(app)
      .post('/billing/cancel-now')
      .send({});

    expect(res.statusCode).toBe(200);

    expect(
      stripeMock.subscriptions.cancel
    ).toHaveBeenCalledWith('sub_123');

    expect(
      prismaMock.appSubscription.updateMany
    ).toHaveBeenCalledWith({
      where: {
        provider: 'STRIPE',
        providerSubscriptionKey: 'sub_123',
      },
      data: {
        status: 'CANCELED',
        grantsAccess: false,
        autoRenewEnabled: false,
        endsAt: expect.any(Date),
        lastVerifiedAt: expect.any(Date),
        rawResponse: {
          source: 'billing-cancel-now',
          livemode: false,
        },
      },
    });

    expect(
      recomputeUserAppEntitlementMock
    ).toHaveBeenCalledWith(
      1,
      {
        db: prismaMock,
        now: expect.any(Date),
      }
    );

    expect(res.body).toEqual({
      ok: true,
      canceledProvider: 'STRIPE',
      plan: 'FREE',
      status: 'INACTIVE',
      provider: null,
      endsAt: null,
    });
  });
});
