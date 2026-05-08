/**
 * @jest-environment node
 */
import { jest } from '@jest/globals';
import express from 'express';
import request from 'supertest';

let prismaMock;
let stripeMock;
let billingRouter;

beforeAll(async () => {
  process.env.NODE_ENV = 'test';
  process.env.STRIPE_SECRET_KEY = 'sk_test_123';
  process.env.WEB_URL = 'https://app.test';
  process.env.STRIPE_PRICE_PLUS_MONTHLY = 'price_plus';
  process.env.STRIPE_PRICE_PREMIUM_MONTHLY = 'price_prem_m';
  process.env.STRIPE_PRICE_PREMIUM_ANNUAL = 'price_prem_a';

  await jest.unstable_mockModule('../utils/prismaClient.js', () => {
    prismaMock = {
      user: {
        findUnique: jest.fn(),
        update: jest.fn(),
      },
    };

    return {
      __esModule: true,
      default: prismaMock,
    };
  });

  await jest.unstable_mockModule('stripe', () => {
    stripeMock = {
      customers: {
        create: jest.fn(),
      },
      checkout: {
        sessions: {
          create: jest.fn(),
        },
      },
      billingPortal: {
        sessions: {
          create: jest.fn(),
        },
      },
    };

    const StripeCtor = jest.fn(() => stripeMock);

    return {
      __esModule: true,
      default: StripeCtor,
    };
  });

  ({ default: billingRouter } = await import('../routes/billing.js'));
});

afterEach(() => {
  jest.clearAllMocks();
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
        provider: null,
      },
    });
  });

  test('returns current user plan from DB', async () => {
    const app = buildApp();

    const renewsAt = new Date('2026-01-01T00:00:00.000Z');

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
        billingSubscriptionId: true,
      },
    });

    expect(res.body).toEqual({
      plan: {
        id: 'sub_123',
        code: 'PREMIUM',
        label: 'Chatforia Premium',
        isFree: false,
        status: 'ACTIVE',
        renewsAt: renewsAt.toISOString(),
        provider: 'STRIPE',
      },
    });
  });
});

describe('POST /billing/checkout', () => {
  test('returns 401 when no user', async () => {
    const app = buildUnauthedApp();

    const res = await request(app).post('/billing/checkout').send({});

    expect(res.statusCode).toBe(401);
    expect(res.body).toEqual({ error: 'Unauthorized' });
  });

  test('creates checkout session for PLUS_MONTHLY using existing billing customer', async () => {
    const app = buildApp();

    prismaMock.user.findUnique.mockResolvedValue({
      id: 1,
      email: 'user@test.com',
      username: 'julian',
      billingCustomerId: 'cus_123',
    });

    stripeMock.checkout.sessions.create.mockResolvedValue({
      id: 'cs_123',
      url: 'https://stripe.test/checkout/cs_123',
    });

    const res = await request(app)
      .post('/billing/checkout')
      .send({ plan: 'PLUS_MONTHLY' });

    expect(res.statusCode).toBe(200);

    expect(prismaMock.user.findUnique).toHaveBeenCalledWith({
      where: { id: 1 },
      select: {
        id: true,
        email: true,
        username: true,
        billingCustomerId: true,
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
        billingProvider: 'STRIPE',
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
      error: 'Invalid or unconfigured plan',
    });
  });

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
    expect(res.body).toEqual({ error: 'Unauthorized' });
  });

  test('returns 400 when user has no billing customer', async () => {
    const app = buildApp();

    prismaMock.user.findUnique.mockResolvedValue({
      billingCustomerId: null,
    });

    const res = await request(app).post('/billing/portal').send({});

    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({ error: 'No billing customer found' });
  });

  test('creates billing portal session', async () => {
    const app = buildApp();

    prismaMock.user.findUnique.mockResolvedValue({
      billingCustomerId: 'cus_123',
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
        billingCustomerId: true,
      },
    });

    expect(stripeMock.billingPortal.sessions.create).toHaveBeenCalledWith({
      customer: 'cus_123',
      return_url: 'https://app.test/account/plan',
    });

    expect(res.body).toEqual({
      url: 'https://stripe.test/portal/bps_123',
      portalUrl: 'https://stripe.test/portal/bps_123',
    });
  });
});