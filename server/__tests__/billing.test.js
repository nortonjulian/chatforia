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
  process.env.STRIPE_SKIP_SIG_CHECK = 'true';
  process.env.STRIPE_PRICE_PLUS = 'price_plus';
  process.env.STRIPE_PRICE_PREMIUM_MONTHLY = 'price_prem_m';
  process.env.STRIPE_PRICE_PREMIUM_ANNUAL = 'price_prem_a';
  process.env.REFUND_ON_IMMEDIATE_CANCEL = 'true';

  // --- Mock prisma client (../utils/prismaClient.js) ---
  await jest.unstable_mockModule('../utils/prismaClient.js', () => {
    prismaMock = {
      user: {
        update: jest.fn(),
        updateMany: jest.fn(),
      },
      regionRule: {
        findUnique: jest.fn(),
      },
      price: {
        findUnique: jest.fn(),
      },
    };
    return {
      __esModule: true,
      default: prismaMock,
    };
  });

  // --- Mock Stripe (stripe) ---
  await jest.unstable_mockModule('stripe', () => {
    stripeMock = {
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
      subscriptions: {
        update: jest.fn(),
        del: jest.fn(),
      },
      invoices: {
        retrieve: jest.fn(),
      },
      refunds: {
        create: jest.fn(),
      },
      webhooks: {
        constructEvent: jest.fn(),
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

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/billing', (req, _res, next) => {
    // default authed user; tests override when needed
    if (!req.user) {
      req.user = {
        id: 1,
        email: 'user@test.com',
        stripeCustomerId: 'cus_123',
        stripeSubscriptionId: 'sub_123',
      };
    }
    next();
  });
  app.use('/billing', billingRouter);
  return app;
}

/* ----------------------------------------------
 * /checkout
 * --------------------------------------------*/
describe('POST /billing/checkout', () => {
  test('returns 401 when no user', async () => {
    const app = express();
    app.use(express.json());
    app.use('/billing', (req, _res, next) => {
      req.user = null;
      next();
    });
    app.use('/billing', billingRouter);

    const res = await request(app).post('/billing/checkout').send({});
    expect(res.statusCode).toBe(401);
    expect(res.body).toEqual({ error: 'Unauthorized' });
  });

  test('uses explicit priceId and creates checkout session', async () => {
    const app = buildApp();

    stripeMock.checkout.sessions.create.mockResolvedValue({
      id: 'cs_123',
      url: 'https://stripe.test/checkout/cs_123',
    });

    const res = await request(app)
      .post('/billing/checkout')
      .send({ priceId: 'price_explicit', plan: 'PLUS_MONTHLY' });

    expect(res.statusCode).toBe(200);
    expect(stripeMock.checkout.sessions.create).toHaveBeenCalledWith({
      mode: 'subscription',
      customer: 'cus_123',
      line_items: [{ price: 'price_explicit', quantity: 1 }],
      success_url: 'https://app.test/upgrade/success?session_id={CHECKOUT_SESSION_ID}',
      cancel_url: 'https://app.test/upgrade?canceled=1',
      allow_promotion_codes: false,
      automatic_tax: { enabled: true },
      client_reference_id: '1',
      metadata: { userId: '1', plan: 'PLUS_MONTHLY' },
    });

    expect(res.body).toEqual({
      url: 'https://stripe.test/checkout/cs_123',
      checkoutUrl: 'https://stripe.test/checkout/cs_123',
    });
  });

  test('resolves priceId from region pricing when only plan is provided', async () => {
    const app = buildApp();

    // regionRule tier
    prismaMock.regionRule.findUnique.mockResolvedValue({ countryCode: 'US', tier: 'ROW' });
    // first price lookup hits
    prismaMock.price.findUnique.mockResolvedValue({ stripePriceId: 'price_dynamic' });

    stripeMock.checkout.sessions.create.mockResolvedValue({
      id: 'cs_456',
      url: 'https://stripe.test/checkout/cs_456',
    });

    const res = await request(app)
      .post('/billing/checkout')
      .send({ plan: 'PREMIUM_MONTHLY' });

    expect(res.statusCode).toBe(200);

    // dynamic resolver uses product + tier/currency
    expect(prismaMock.price.findUnique).toHaveBeenCalledWith({
      where: {
        product_tier_currency: {
          product: 'chatforia_premium_monthly',
          tier: 'ROW',
          currency: 'USD',
        },
      },
    });

    expect(stripeMock.checkout.sessions.create).toHaveBeenCalledWith(
      expect.objectContaining({
        line_items: [{ price: 'price_dynamic', quantity: 1 }],
      })
    );
  });

  test('returns 400 when no usable price is found', async () => {
    const app = buildApp();

    // No priceId and no plan
    const res = await request(app)
      .post('/billing/checkout')
      .send({});

    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({ error: 'Missing or unknown price' });
  });
});

/* ----------------------------------------------
 * /portal
 * --------------------------------------------*/
describe('POST /billing/portal', () => {
  test('returns 401 when no user', async () => {
    const app = express();
    app.use(express.json());
    app.use('/billing', (req, _res, next) => {
      req.user = null;
      next();
    });
    app.use('/billing', billingRouter);

    const res = await request(app).post('/billing/portal').send({});
    expect(res.statusCode).toBe(401);
    expect(res.body).toEqual({ error: 'Unauthorized' });
  });

  test('creates billing portal session', async () => {
    const app = buildApp();

    stripeMock.billingPortal.sessions.create.mockResolvedValue({
      id: 'bps_123',
      url: 'https://stripe.test/portal/bps_123',
    });

    const res = await request(app).post('/billing/portal').send({});

    expect(res.statusCode).toBe(200);
    expect(stripeMock.billingPortal.sessions.create).toHaveBeenCalledWith({
      customer: 'cus_123',
      return_url: 'https://app.test/billing/return',
    });
    expect(res.body).toEqual({
      url: 'https://stripe.test/portal/bps_123',
      portalUrl: 'https://stripe.test/portal/bps_123',
    });
  });
});

/* ----------------------------------------------
 * /cancel
 * --------------------------------------------*/
describe('POST /billing/cancel', () => {
  test('returns 401 when no user', async () => {
    const app = express();
    app.use(express.json());
    app.use('/billing', (req, _res, next) => {
      req.user = null;
      next();
    });
    app.use('/billing', billingRouter);

    const res = await request(app).post('/billing/cancel').send({});
    expect(res.statusCode).toBe(401);
    expect(res.body).toEqual({ error: 'Unauthorized' });
  });

  test('returns 400 when no active subscription', async () => {
    const app = express();
    app.use(express.json());
    app.use('/billing', (req, _res, next) => {
      req.user = { id: 1, stripeSubscriptionId: null };
      next();
    });
    app.use('/billing', billingRouter);

    const res = await request(app).post('/billing/cancel').send({});
    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({ error: 'No active subscription' });
  });

  test('sets cancel_at_period_end and updates planExpiresAt', async () => {
    const app = buildApp();

    stripeMock.subscriptions.update.mockResolvedValue({
      id: 'sub_123',
      current_period_end: 1700000000,
    });

    const res = await request(app).post('/billing/cancel').send({});

    expect(res.statusCode).toBe(200);
    expect(stripeMock.subscriptions.update).toHaveBeenCalledWith('sub_123', {
      cancel_at_period_end: true,
    });
    expect(prismaMock.user.update).toHaveBeenCalledWith({
      where: { id: 1 },
      data: { planExpiresAt: expect.any(Date) },
    });
    expect(res.body).toEqual({ ok: true, currentPeriodEnd: 1700000000 });
  });
});

/* ----------------------------------------------
 * /uncancel
 * --------------------------------------------*/
describe('POST /billing/uncancel', () => {
  test('returns 400 when no active subscription', async () => {
    const app = express();
    app.use(express.json());
    app.use('/billing', (req, _res, next) => {
      req.user = { id: 1, stripeSubscriptionId: null };
      next();
    });
    app.use('/billing', billingRouter);

    const res = await request(app).post('/billing/uncancel').send({});
    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({ error: 'No active subscription' });
  });

  test('clears cancel_at_period_end and updates planExpiresAt', async () => {
    const app = buildApp();

    stripeMock.subscriptions.update.mockResolvedValue({
      id: 'sub_123',
      current_period_end: 1800000000,
    });

    const res = await request(app).post('/billing/uncancel').send({});

    expect(res.statusCode).toBe(200);
    expect(stripeMock.subscriptions.update).toHaveBeenCalledWith('sub_123', {
      cancel_at_period_end: false,
    });
    expect(prismaMock.user.update).toHaveBeenCalledWith({
      where: { id: 1 },
      data: { planExpiresAt: expect.any(Date) },
    });
    expect(res.body).toEqual({ ok: true, currentPeriodEnd: 1800000000 });
  });
});

/* ----------------------------------------------
 * /cancel-now
 * --------------------------------------------*/
describe('POST /billing/cancel-now', () => {
  test('returns 400 when no active subscription', async () => {
    const app = express();
    app.use(express.json());
    app.use('/billing', (req, _res, next) => {
      req.user = { id: 1, stripeSubscriptionId: null };
      next();
    });
    app.use('/billing', billingRouter);

    const res = await request(app).post('/billing/cancel-now').send({});
    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({ error: 'No active subscription' });
  });

  test('deletes subscription, refunds latest invoice and sets user to FREE', async () => {
    const app = buildApp();

    stripeMock.subscriptions.del.mockResolvedValue({
      id: 'sub_123',
      latest_invoice: 'in_123',
    });
    stripeMock.invoices.retrieve.mockResolvedValue({
      id: 'in_123',
      payment_intent: 'pi_123',
    });
    stripeMock.refunds.create.mockResolvedValue({ id: 're_123' });

    const res = await request(app).post('/billing/cancel-now').send({});

    expect(res.statusCode).toBe(200);
    expect(stripeMock.subscriptions.del).toHaveBeenCalledWith('sub_123');
    expect(stripeMock.invoices.retrieve).toHaveBeenCalledWith('in_123');
    expect(stripeMock.refunds.create).toHaveBeenCalledWith({
      payment_intent: 'pi_123',
    });
    expect(prismaMock.user.update).toHaveBeenCalledWith({
      where: { id: 1 },
      data: { plan: 'FREE', stripeSubscriptionId: null, planExpiresAt: null },
    });
    expect(res.body).toEqual({ ok: true });
  });
});

/* ----------------------------------------------
 * /refund-invoice
 * --------------------------------------------*/
describe('POST /billing/refund-invoice', () => {
  test('requires invoiceId', async () => {
    const app = buildApp();

    const res = await request(app).post('/billing/refund-invoice').send({});
    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({ error: 'Missing invoiceId' });
  });

  test('refunds invoice using amountOptionalCents when provided', async () => {
    const app = buildApp();

    stripeMock.invoices.retrieve.mockResolvedValue({
      id: 'in_999',
      payment_intent: 'pi_999',
    });
    stripeMock.refunds.create.mockResolvedValue({ id: 're_999' });

    const res = await request(app)
      .post('/billing/refund-invoice')
      .send({ invoiceId: 'in_999', amountOptionalCents: 1234 });

    expect(res.statusCode).toBe(200);
    expect(stripeMock.invoices.retrieve).toHaveBeenCalledWith('in_999');
    expect(stripeMock.refunds.create).toHaveBeenCalledWith({
      payment_intent: 'pi_999',
      amount: 1234,
    });
    expect(res.body).toEqual({ ok: true });
  });

  test('returns 400 when invoice has no payment_intent', async () => {
    const app = buildApp();

    stripeMock.invoices.retrieve.mockResolvedValue({
      id: 'in_no_pi',
      payment_intent: null,
    });

    const res = await request(app)
      .post('/billing/refund-invoice')
      .send({ invoiceId: 'in_no_pi' });

    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({ error: 'No payment intent for invoice' });
  });
});

/* ----------------------------------------------
 * /webhook (basic path)
 * --------------------------------------------*/
describe('POST /billing/webhook', () => {
  test('handles checkout.session.completed and updates user plan', async () => {
    const app = buildApp();

    const event = {
      type: 'checkout.session.completed',
      data: {
        object: {
          client_reference_id: '42',
          metadata: { plan: 'PLUS_MONTHLY' },
          customer: 'cus_777',
          subscription: 'sub_777',
          expires_at: 1900000000,
        },
      },
    };

    const res = await request(app)
      .post('/billing/webhook')
      .set('stripe-signature', 'testsig')
      .send(event);

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ received: true });

    // plan PLUS_MONTHLY => PLUS
    expect(prismaMock.user.update).toHaveBeenCalledWith({
      where: { id: 42 },
      data: expect.objectContaining({
        plan: 'PLUS',
        stripeCustomerId: 'cus_777',
        stripeSubscriptionId: 'sub_777',
      }),
    });
  });
});
