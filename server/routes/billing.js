import express from 'express';
import prisma from '../utils/prismaClient.js';

const router = express.Router();

const COUNTRY_CURRENCY = {
  US: 'USD',
  CA: 'CAD',
  GB: 'GBP',
  IE: 'EUR',
  DE: 'EUR',
  FR: 'EUR',
  NL: 'EUR',
  SE: 'SEK',
  NO: 'NOK',
  DK: 'DKK',
  FI: 'EUR',
  CH: 'CHF',
  AU: 'AUD',
  NZ: 'NZD',
  JP: 'JPY',
  KR: 'KRW',
  SG: 'SGD',
  PL: 'PLN',
  CZ: 'CZK',
  PT: 'EUR',
  ES: 'EUR',
  IT: 'EUR',
  ZA: 'ZAR',
  MX: 'MXN',
  CL: 'CLP',
  AR: 'ARS',
  AE: 'AED',
  IN: 'INR',
  BR: 'BRL',
  PH: 'PHP',
  TH: 'THB',
  VN: 'VND',
  ID: 'IDR',
  TR: 'TRY',
  CO: 'COP',
  PE: 'PEN',
  NG: 'NGN',
  KE: 'KES',
  EG: 'EGP',
  PK: 'PKR',
  BD: 'BDT',
};

function normalizePlanCode(code) {
  return String(code || 'FREE').trim().toUpperCase();
}

function labelForPlan(code) {
  switch (normalizePlanCode(code)) {
    case 'PLUS':
      return 'Chatforia Plus';
    case 'PREMIUM':
      return 'Chatforia Premium';
    case 'WIRELESS':
      return 'Chatforia Wireless';
    case 'FREE':
    default:
      return 'Chatforia Free';
  }
}

function normalizeCountry(country) {
  const v = String(country || '').trim().toUpperCase();
  return v.length === 2 ? v : 'US';
}

function buildHostedPaddleCheckoutUrl({ priceId, userId, email, successUrl, cancelUrl }) {
  const url = new URL('https://checkout.paddle.com/');

  url.searchParams.set('price_id', priceId);

  if (userId != null) {
    url.searchParams.set('custom_data[userId]', String(userId));
  }

  if (email) {
    url.searchParams.set('customer[email]', String(email));
  }

  if (successUrl) {
    url.searchParams.set('success_url', successUrl);
  }

  if (cancelUrl) {
    url.searchParams.set('cancel_url', cancelUrl);
  }

  return url.toString();
}

async function resolveRegionContext(user, countryOverride) {
  const country = normalizeCountry(user?.billingCountry || countryOverride || 'US');
  const rule = await prisma.regionRule.findUnique({
    where: { countryCode: country },
  });

  const tier = user?.pricingRegion || rule?.tier || 'ROW';
  const currency = String(user?.currency || COUNTRY_CURRENCY[country] || 'USD').toUpperCase();

  return { country, tier, currency };
}

async function resolvePriceRowForProduct(product, user, opts = {}) {
  if (!product) return null;

  const { country, tier, currency } = await resolveRegionContext(user, opts.country);

  let price = await prisma.price.findUnique({
    where: {
      product_tier_currency: { product, tier, currency },
    },
  });

  if (!price && currency !== 'USD') {
    price = await prisma.price.findUnique({
      where: {
        product_tier_currency: { product, tier, currency: 'USD' },
      },
    });
  }

  if (!price) {
    price = await prisma.price.findUnique({
      where: {
        product_tier_currency: { product, tier: 'ROW', currency: 'USD' },
      },
    });
  }

  return price;
}

function productForPlan(plan) {
  switch (normalizePlanCode(plan)) {
    case 'PLUS_MONTHLY':
      return 'chatforia_plus';
    case 'PREMIUM_MONTHLY':
      return 'chatforia_premium_monthly';
    case 'PREMIUM_ANNUAL':
      return 'chatforia_premium_annual';
    default:
      return null;
  }
}

function paddlePriceIdFromEnvForPlan(plan) {
  switch (normalizePlanCode(plan)) {
    case 'PLUS_MONTHLY':
      return process.env.PADDLE_PRICE_PLUS_MONTHLY || null;
    case 'PREMIUM_MONTHLY':
      return process.env.PADDLE_PRICE_PREMIUM_MONTHLY || null;
    case 'PREMIUM_ANNUAL':
      return process.env.PADDLE_PRICE_PREMIUM_ANNUAL || null;
    default:
      return null;
  }
}

async function resolvePaddlePriceIdForPlan(user, plan, opts = {}) {
  const product = productForPlan(plan);
  if (!product) return null;

  const price = await resolvePriceRowForProduct(product, user, opts);
  return price?.paddlePriceId || price?.providerPriceId || null;
}

router.get('/my-plan', async (req, res) => {
  try {
    const userId = req.user?.id ? Number(req.user.id) : null;

    if (!userId) {
      return res.json({
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
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        plan: true,
        subscriptionStatus: true,
        subscriptionEndsAt: true,
        billingProvider: true,
        billingCustomerId: true,
        billingSubscriptionId: true,
      },
    });

    if (!user) {
      return res.json({
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
    }

    const code = normalizePlanCode(user.plan);
    const label = labelForPlan(code);

    return res.json({
      plan: {
        id: user.billingSubscriptionId || null,
        code,
        label,
        isFree: code === 'FREE',
        status: user.subscriptionStatus || 'INACTIVE',
        renewsAt: user.subscriptionEndsAt
          ? new Date(user.subscriptionEndsAt).toISOString()
          : null,
        provider: user.billingProvider || null,
      },
    });
  } catch (err) {
    console.error('[billing/my-plan] error:', err);
    return res.status(500).json({
      error: 'Unable to load plan',
    });
  }
});

router.post('/checkout', async (req, res) => {
  try {
    if (!req.user?.id) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const userId = Number(req.user.id);
    const plan = normalizePlanCode(req.body?.plan);

    if (!['PLUS_MONTHLY', 'PREMIUM_MONTHLY', 'PREMIUM_ANNUAL'].includes(plan)) {
      return res.status(400).json({ error: 'Invalid plan' });
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        billingCountry: true,
        pricingRegion: true,
        currency: true,
      },
    });

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const countryOverride = req.body?.country ? String(req.body.country) : undefined;

    let priceId = await resolvePaddlePriceIdForPlan(user, plan, { country: countryOverride });

    if (!priceId) {
      priceId = paddlePriceIdFromEnvForPlan(plan);
    }

    if (!priceId) {
      return res.status(500).json({
        error: 'No Paddle price configured for this plan',
      });
    }

    const frontendOrigin =
      process.env.FRONTEND_ORIGIN ||
      process.env.WEB_URL ||
      'http://localhost:5173';

    const successUrl = `${frontendOrigin}/upgrade?success=1`;
    const cancelUrl = `${frontendOrigin}/upgrade?canceled=1`;

    const checkoutUrl = buildHostedPaddleCheckoutUrl({
      priceId,
      userId: user.id,
      email: user.email,
      successUrl,
      cancelUrl,
    });

    return res.json({
      checkoutUrl,
      url: checkoutUrl,
      priceId,
      plan,
    });
  } catch (err) {
    console.error('[billing/checkout] error:', err);
    return res.status(500).json({
      error: 'Unable to start checkout',
    });
  }
});

export default router;