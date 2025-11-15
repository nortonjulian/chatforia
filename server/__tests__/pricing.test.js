import { jest, describe, it, expect, beforeEach } from '@jest/globals';
import request from 'supertest';
import express from 'express';

// --- Prisma mock wiring ------------------------------------------------------

const mockRegionRuleFindUnique = jest.fn();
const mockPriceFindUnique = jest.fn();

const mockPrismaInstance = {
  regionRule: { findUnique: mockRegionRuleFindUnique },
  price: { findUnique: mockPriceFindUnique },
};

// Mock @prisma/client *before* importing the router
jest.unstable_mockModule('@prisma/client', () => ({
  PrismaClient: jest.fn(() => mockPrismaInstance),
}));

// Now import the router under test
// Adjust path if this test is not in the same folder as pricing.js
const { default: pricingRouter } = await import('../routes/pricing.js');

// --- Helper to build an app with optional user / geoCountry ------------------

function createApp({ user, geoCountry } = {}) {
  const app = express();

  app.use((req, res, next) => {
    if (user) req.user = user;
    if (geoCountry) req.geoCountry = geoCountry;
    next();
  });

  app.use('/pricing', pricingRouter);
  return app;
}

beforeEach(() => {
  mockRegionRuleFindUnique.mockReset();
  mockPriceFindUnique.mockReset();
});

// --- Tests -------------------------------------------------------------------

describe('GET /pricing/quote', () => {
  it('returns a quote using explicit country, currency, and product', async () => {
    // tierForCountry('DE') -> "EU1"
    mockRegionRuleFindUnique.mockResolvedValueOnce({
      countryCode: 'DE',
      tier: 'EU1',
    });

    // First price lookup succeeds (no fallbacks)
    mockPriceFindUnique.mockResolvedValueOnce({
      product: 'chatforia_premium',
      tier: 'EU1',
      currency: 'EUR',
      unitAmount: 1299, // €12.99
      active: true,
      stripePriceId: 'price_123',
      appleSku: 'apple_123',
      googleSku: 'google_123',
    });

    const app = createApp();

    const res = await request(app)
      .get('/pricing/quote')
      .query({
        country: 'de',
        currency: 'eur',
        product: 'chatforia_premium',
      });

    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({
      product: 'chatforia_premium',
      country: 'DE',
      regionTier: 'EU1',
      currency: 'EUR',
      unitAmount: 1299,
      stripePriceId: 'price_123',
      appleSku: 'apple_123',
      googleSku: 'google_123',
      display: {
        amount: '12.99',
        currency: 'EUR',
      },
    });

    expect(mockRegionRuleFindUnique).toHaveBeenCalledWith({
      where: { countryCode: 'DE' },
    });

    expect(mockPriceFindUnique).toHaveBeenCalledWith({
      where: {
        product_tier_currency: {
          product: 'chatforia_premium',
          tier: 'EU1',
          currency: 'EUR',
        },
      },
    });
  });

  it('uses user billingCountry, pricingRegion, and currency when query params are missing', async () => {
    const user = {
      billingCountry: 'CA',
      pricingRegion: 'NA',
      currency: 'CAD',
    };

    // Because pricingRegion is set, tierForCountry() should not be called
    mockPriceFindUnique.mockResolvedValueOnce({
      product: 'chatforia_premium',
      tier: 'NA',
      currency: 'CAD',
      unitAmount: 1499,
      active: true,
      stripePriceId: null,
      appleSku: null,
      googleSku: null,
    });

    const app = createApp({ user });

    const res = await request(app).get('/pricing/quote');

    expect(res.statusCode).toBe(200);
    expect(res.body.country).toBe('CA');
    expect(res.body.regionTier).toBe('NA');
    expect(res.body.currency).toBe('CAD');
    expect(res.body.unitAmount).toBe(1499);
    expect(mockRegionRuleFindUnique).not.toHaveBeenCalled();
  });

  it('falls back to USD for the same tier when local currency is missing', async () => {
    // tierForCountry('GB') -> GB1
    mockRegionRuleFindUnique.mockResolvedValueOnce({
      countryCode: 'GB',
      tier: 'GB1',
    });

    // 1st lookup: product/GB1/GBP -> no price
    // 2nd lookup: product/GB1/USD -> succeeds
    mockPriceFindUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        product: 'chatforia_premium',
        tier: 'GB1',
        currency: 'USD',
        unitAmount: 999, // $9.99
        active: true,
        stripePriceId: 'price_usd',
        appleSku: null,
        googleSku: null,
      });

    const app = createApp();

    const res = await request(app)
      .get('/pricing/quote')
      .query({ country: 'GB' });

    expect(res.statusCode).toBe(200);
    expect(res.body.country).toBe('GB');
    expect(res.body.regionTier).toBe('GB1');
    expect(res.body.currency).toBe('USD');
    expect(res.body.unitAmount).toBe(999);

    expect(mockPriceFindUnique).toHaveBeenNthCalledWith(1, {
      where: {
        product_tier_currency: {
          product: 'chatforia_premium',
          tier: 'GB1',
          currency: 'GBP',
        },
      },
    });

    expect(mockPriceFindUnique).toHaveBeenNthCalledWith(2, {
      where: {
        product_tier_currency: {
          product: 'chatforia_premium',
          tier: 'GB1',
          currency: 'USD',
        },
      },
    });
  });

  it('falls back to ROW/USD when no price exists for tier/currency', async () => {
    // tierForCountry('BR') -> BR1
    mockRegionRuleFindUnique.mockResolvedValueOnce({
      countryCode: 'BR',
      tier: 'BR1',
    });

    // 1st lookup: BRL -> null
    // 2nd lookup: BR1/USD -> null
    // 3rd lookup: ROW/USD -> success
    mockPriceFindUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        product: 'chatforia_premium',
        tier: 'ROW',
        currency: 'USD',
        unitAmount: 1099,
        active: true,
        stripePriceId: 'price_row_usd',
        appleSku: null,
        googleSku: null,
      });

    const app = createApp();

    const res = await request(app)
      .get('/pricing/quote')
      .query({ country: 'BR' });

    expect(res.statusCode).toBe(200);
    // regionTier stays as BR1 even though the fallback price uses ROW
    expect(res.body.regionTier).toBe('BR1');
    expect(res.body.currency).toBe('USD');
    expect(res.body.unitAmount).toBe(1099);

    expect(mockPriceFindUnique).toHaveBeenNthCalledWith(1, {
      where: {
        product_tier_currency: {
          product: 'chatforia_premium',
          tier: 'BR1',
          currency: 'BRL',
        },
      },
    });

    expect(mockPriceFindUnique).toHaveBeenNthCalledWith(3, {
      where: {
        product_tier_currency: {
          product: 'chatforia_premium',
          tier: 'ROW',
          currency: 'USD',
        },
      },
    });
  });

  it('does not divide by 100 for zero-decimal currencies like JPY', async () => {
    mockRegionRuleFindUnique.mockResolvedValueOnce({
      countryCode: 'JP',
      tier: 'JP1',
    });

    mockPriceFindUnique.mockResolvedValueOnce({
      product: 'chatforia_premium',
      tier: 'JP1',
      currency: 'JPY',
      unitAmount: 1000,
      active: true,
      stripePriceId: 'price_jpy',
      appleSku: null,
      googleSku: null,
    });

    const app = createApp();

    const res = await request(app)
      .get('/pricing/quote')
      .query({ country: 'JP', currency: 'JPY' });

    expect(res.statusCode).toBe(200);
    expect(res.body.currency).toBe('JPY');
    // JPY in your code uses divisor 1, so amount is "1000"
    expect(res.body.display).toEqual({
      amount: '1000',
      currency: 'JPY',
    });
  });

  it('returns 404 when no active price is configured', async () => {
    mockRegionRuleFindUnique.mockResolvedValueOnce({
      countryCode: 'US',
      tier: 'US1',
    });

    // First lookup returns inactive price; fallbacks are skipped because price is non-null
    mockPriceFindUnique.mockResolvedValueOnce({
      product: 'chatforia_premium',
      tier: 'US1',
      currency: 'USD',
      unitAmount: 999,
      active: false,
      stripePriceId: 'price_inactive',
      appleSku: null,
      googleSku: null,
    });

    const app = createApp();

    const res = await request(app)
      .get('/pricing/quote')
      .query({ country: 'US' });

    expect(res.statusCode).toBe(404);
    expect(res.body).toEqual({ error: 'No active price configured' });
  });

  it('returns 500 when Prisma throws', async () => {
    // Make tierForCountry throw via regionRule.findUnique
    mockRegionRuleFindUnique.mockRejectedValueOnce(
      new Error('DB is down')
    );

    const app = createApp();

    const res = await request(app)
      .get('/pricing/quote')
      .query({ country: 'US' });

    expect(res.statusCode).toBe(500);
    expect(res.body).toEqual({ error: 'Pricing quote failed' });
  });
});
