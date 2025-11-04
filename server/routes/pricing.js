import express from 'express';
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

const router = express.Router();

/**
 * Map of country -> default currency (for web checkout).
 * For App Store / Play, you’ll get storefront currency from the platform.
 */
const COUNTRY_CURRENCY = {
  US: 'USD', CA: 'CAD', GB: 'GBP', IE: 'EUR', DE: 'EUR', FR: 'EUR', NL: 'EUR', SE: 'SEK',
  NO: 'NOK', DK: 'DKK', FI: 'EUR', CH: 'CHF', AU: 'AUD', NZ: 'NZD', JP: 'JPY', KR: 'KRW',
  SG: 'SGD', PL: 'PLN', CZ: 'CZK', PT: 'EUR', ES: 'EUR', IT: 'EUR', ZA: 'ZAR', MX: 'MXN',
  CL: 'CLP', AR: 'ARS', AE: 'AED', IN: 'INR', BR: 'BRL', PH: 'PHP', TH: 'THB', VN: 'VND',
  ID: 'IDR', TR: 'TRY', CO: 'COP', PE: 'PEN', NG: 'NGN', KE: 'KES', EG: 'EGP', PK: 'PKR',
  BD: 'BDT'
};

function pickCurrencyForCountry(country) {
  const cc = (country || '').toUpperCase();
  return COUNTRY_CURRENCY[cc] || 'USD';
}

async function tierForCountry(country) {
  const cc = (country || '').toUpperCase();
  if (!cc) return 'ROW';
  const rule = await prisma.regionRule.findUnique({ where: { countryCode: cc } });
  return rule?.tier || 'ROW';
}

// GET /pricing/quote?country=US&currency=USD&product=chatforia_premium
router.get('/quote', async (req, res) => {
  try {
    const user = req.user || null; // if you attach user on auth middleware
    const product = (req.query.product || 'chatforia_premium').toString();

    // Evidence (ordered by trust)
    const qCountry = (req.query.country || '').toString().toUpperCase();
    const qCurrency = (req.query.currency || '').toString().toUpperCase();

    // If you run a real geolocation middleware, set req.geoCountry
    const ipCountry = (req.geoCountry || '').toString().toUpperCase();

    // 1) Determine target country
    const country =
      qCountry ||
      user?.billingCountry ||
      ipCountry ||
      'US';

    // 2) Resolve tier
    const tier = user?.pricingRegion || await tierForCountry(country);

    // 3) Decide currency
    const currency =
      qCurrency ||
      user?.currency ||
      pickCurrencyForCountry(country);

    // 4) Look up active price row
    let price = await prisma.price.findUnique({
      where: { product_tier_currency: { product, tier, currency } },
    });

    // fallback 1: same tier in USD
    if (!price && currency !== 'USD') {
      price = await prisma.price.findUnique({
        where: { product_tier_currency: { product, tier, currency: 'USD' } },
      });
    }

    // fallback 2: ROW/USD
    if (!price) {
      price = await prisma.price.findUnique({
        where: { product_tier_currency: { product, tier: 'ROW', currency: 'USD' } },
      });
    }

    if (!price || !price.active) {
      return res.status(404).json({ error: 'No active price configured' });
    }

    // Shape response for client
    return res.json({
      product,
      country,
      regionTier: tier,
      currency: price.currency,
      unitAmount: price.unitAmount, // minor units
      stripePriceId: price.stripePriceId || null,
      appleSku: price.appleSku || null,
      googleSku: price.googleSku || null,
      // Optional: for UI
      display: {
        amount: (price.unitAmount / (['JPY','KRW','CLP','VND','IDR'].includes(price.currency) ? 1 : 100)).toString(),
        currency: price.currency,
      },
    });
  } catch (e) {
    console.error('Pricing quote failed', e);
    res.status(500).json({ error: 'Pricing quote failed' });
  }
});

export default router;
