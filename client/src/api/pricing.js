import axiosClient from '@/api/axiosClient';

/**
 * Fetch a pricing quote for the current user/region.
 *
 * Usage:
 *   getPricingQuote({ product: 'chatforia_plus' })
 *   getPricingQuote({ product: 'chatforia_premium_monthly' })
 *   getPricingQuote({ product: 'chatforia_premium_annual' })
 *
 * eSIM packs (supported ids):
 *   Legacy / current:
 *     chatforia_esim_local_3
 *     chatforia_esim_europe_10
 *     chatforia_esim_global_5
 *     chatforia_esim_local_unlimited
 *
 *   Future / premium-aware:
 *     chatforia_esim_local_3_premium
 *     chatforia_esim_local_3_standard
 *     chatforia_esim_europe_unlimited_premium
 *     chatforia_esim_global_unlimited_premium
 *
 *   Also supports "gb" suffix variants:
 *     chatforia_esim_local_3gb
 *     chatforia_esim_local_3gb_premium
 *
 * @param {Object} [opts]
 * @param {string} [opts.country]  - ISO 3166-1 alpha-2 (e.g., "US")
 * @param {string} [opts.currency] - ISO 4217 (e.g., "USD")
 * @param {string} [opts.product]  - Defaults to "chatforia_premium_monthly"
 * @returns {Promise<object|null>} Quote or null if unavailable
 */

// Hard-coded safety net for UI formatting if the quote API fails.
const FALLBACKS = {
  // App plans
  chatforia_plus: { currency: 'USD', unitAmount: 699 },
  chatforia_premium_monthly: { currency: 'USD', unitAmount: 1199 },
  chatforia_premium_annual: { currency: 'USD', unitAmount: 9900 },

  // Local - current / legacy ids (treated as premium/default)
  chatforia_esim_local_3: { currency: 'USD', unitAmount: 1499 },
  chatforia_esim_local_5: { currency: 'USD', unitAmount: 2299 },
  chatforia_esim_local_10: { currency: 'USD', unitAmount: 3499 },
  chatforia_esim_local_20: { currency: 'USD', unitAmount: 5499 },
  chatforia_esim_local_unlimited: { currency: 'USD', unitAmount: 5999 },

  // Europe - current / legacy ids
  chatforia_esim_europe_3: { currency: 'USD', unitAmount: 1699 },
  chatforia_esim_europe_5: { currency: 'USD', unitAmount: 2499 },
  chatforia_esim_europe_10: { currency: 'USD', unitAmount: 3699 },
  chatforia_esim_europe_20: { currency: 'USD', unitAmount: 6499 },
  chatforia_esim_europe_unlimited: { currency: 'USD', unitAmount: 6999 },

  // Global - current / legacy ids
  chatforia_esim_global_3: { currency: 'USD', unitAmount: 2199 },
  chatforia_esim_global_5: { currency: 'USD', unitAmount: 3299 },
  chatforia_esim_global_10: { currency: 'USD', unitAmount: 4999 },
  chatforia_esim_global_unlimited: { currency: 'USD', unitAmount: 7999 },

  // Premium ids
  chatforia_esim_local_3_premium: { currency: 'USD', unitAmount: 1499 },
  chatforia_esim_local_5_premium: { currency: 'USD', unitAmount: 2299 },
  chatforia_esim_local_10_premium: { currency: 'USD', unitAmount: 3499 },
  chatforia_esim_local_20_premium: { currency: 'USD', unitAmount: 5499 },
  chatforia_esim_local_unlimited_premium: { currency: 'USD', unitAmount: 5999 },

  chatforia_esim_europe_3_premium: { currency: 'USD', unitAmount: 1699 },
  chatforia_esim_europe_5_premium: { currency: 'USD', unitAmount: 2499 },
  chatforia_esim_europe_10_premium: { currency: 'USD', unitAmount: 3699 },
  chatforia_esim_europe_20_premium: { currency: 'USD', unitAmount: 6499 },
  chatforia_esim_europe_unlimited_premium: { currency: 'USD', unitAmount: 6999 },

  chatforia_esim_global_3_premium: { currency: 'USD', unitAmount: 2199 },
  chatforia_esim_global_5_premium: { currency: 'USD', unitAmount: 3299 },
  chatforia_esim_global_10_premium: { currency: 'USD', unitAmount: 4999 },
  chatforia_esim_global_unlimited_premium: { currency: 'USD', unitAmount: 7999 },

  // Standard ids (kept lower for future Phase 2 if/when you expose them)
  chatforia_esim_local_3_standard: { currency: 'USD', unitAmount: 1299 },
  chatforia_esim_local_5_standard: { currency: 'USD', unitAmount: 1999 },
  chatforia_esim_local_10_standard: { currency: 'USD', unitAmount: 2999 },
  chatforia_esim_local_20_standard: { currency: 'USD', unitAmount: 4999 },
  chatforia_esim_local_unlimited_standard: { currency: 'USD', unitAmount: 5499 },

  chatforia_esim_europe_3_standard: { currency: 'USD', unitAmount: 1499 },
  chatforia_esim_europe_5_standard: { currency: 'USD', unitAmount: 2299 },
  chatforia_esim_europe_10_standard: { currency: 'USD', unitAmount: 3399 },
  chatforia_esim_europe_20_standard: { currency: 'USD', unitAmount: 5999 },
  chatforia_esim_europe_unlimited_standard: { currency: 'USD', unitAmount: 6499 },

  chatforia_esim_global_3_standard: { currency: 'USD', unitAmount: 1999 },
  chatforia_esim_global_5_standard: { currency: 'USD', unitAmount: 2999 },
  chatforia_esim_global_10_standard: { currency: 'USD', unitAmount: 4699 },
  chatforia_esim_global_unlimited_standard: { currency: 'USD', unitAmount: 7499 },
};

// Aliases so bare ids can resolve cleanly even after you move the UI to premium ids.
const PRODUCT_ALIASES = {
  chatforia_esim_local_3: 'chatforia_esim_local_3_premium',
  chatforia_esim_local_5: 'chatforia_esim_local_5_premium',
  chatforia_esim_local_10: 'chatforia_esim_local_10_premium',
  chatforia_esim_local_20: 'chatforia_esim_local_20_premium',
  chatforia_esim_local_unlimited: 'chatforia_esim_local_unlimited_premium',

  chatforia_esim_europe_3: 'chatforia_esim_europe_3_premium',
  chatforia_esim_europe_5: 'chatforia_esim_europe_5_premium',
  chatforia_esim_europe_10: 'chatforia_esim_europe_10_premium',
  chatforia_esim_europe_20: 'chatforia_esim_europe_20_premium',
  chatforia_esim_europe_unlimited: 'chatforia_esim_europe_unlimited_premium',

  chatforia_esim_global_3: 'chatforia_esim_global_3_premium',
  chatforia_esim_global_5: 'chatforia_esim_global_5_premium',
  chatforia_esim_global_10: 'chatforia_esim_global_10_premium',
  chatforia_esim_global_unlimited: 'chatforia_esim_global_unlimited_premium',
};

// For formatting if fallback path is used (display only)
const ZERO_DECIMAL = new Set(['JPY', 'KRW', 'CLP', 'VND', 'IDR']);

function normalizeCountryCode(v) {
  const cc = String(v || '').trim().toUpperCase();
  return cc && cc.length === 2 ? cc : null;
}

// Accept product ids with or without "gb" suffix.
// Examples:
//   chatforia_esim_local_3gb -> chatforia_esim_local_3
//   chatforia_esim_local_3gb_premium -> chatforia_esim_local_3_premium
function normalizeProductId(product) {
  const p = String(product || '').trim();
  if (!p) return null;

  return p
    .replace(/_(\d+)gb(?=(_premium|_standard)?$)/i, '_$1')
    .replace(/(\d+)gb$/i, '$1');
}

// Optional dev override (helps local testing where Cloudflare headers don’t exist)
function getDevGeoCountry() {
  try {
    const v = localStorage.getItem('cf_geo_country'); // e.g. "US"
    return normalizeCountryCode(v);
  } catch {
    return null;
  }
}

function resolveFallbackProductId(product) {
  if (!product) return null;
  return PRODUCT_ALIASES[product] || product;
}

function buildFallbackQuote({ product, country, currency }) {
  const normProduct = normalizeProductId(product);
  const fallbackProduct = resolveFallbackProductId(normProduct);
  const fb = FALLBACKS[fallbackProduct] || FALLBACKS[normProduct];
  if (!fb) return null;

  const curr = String(currency || fb.currency || 'USD').toUpperCase();
  const amt = fb.unitAmount ?? 0;
  const divisor = ZERO_DECIMAL.has(curr) ? 1 : 100;

  return {
    product: fallbackProduct || normProduct,
    country: normalizeCountryCode(country) || 'US',
    regionTier: 'ROW',
    currency: curr,
    unitAmount: amt,
    providerPriceId: null,
    appleSku: null,
    googleSku: null,
    display: {
      amount: (amt / divisor).toString(),
      currency: curr,
    },
  };
}

export async function getPricingQuote(opts = {}) {
  const rawProduct = opts.product || 'chatforia_premium_monthly';
  const normalizedProduct = normalizeProductId(rawProduct);
  const product = resolveFallbackProductId(normalizedProduct);

  const explicitCountry = normalizeCountryCode(opts.country);
  const explicitCurrency = opts.currency ? String(opts.currency).toUpperCase() : undefined;

  // If caller didn’t pass a country, allow a dev override for local testing
  const devGeo = !explicitCountry ? getDevGeoCountry() : null;

  const country = explicitCountry || devGeo || undefined;
  const currency = explicitCurrency || undefined;

  console.log('[getPricingQuote] called with', { product, country, currency });

  try {
    // axiosClient already has baseURL "/api" in your setup
    const { data } = await axiosClient.get('/pricing/quote', {
      params: { product, country, currency },
    });

    const normalized = {
      ...data,
      product:
        resolveFallbackProductId(normalizeProductId(data?.product || product)) || product,
      country:
        normalizeCountryCode(data?.country) ||
        normalizeCountryCode(country) ||
        'US',
    };

    console.log('[getPricingQuote] success', normalized);
    return normalized;
  } catch (err) {
    console.error('[getPricingQuote] failed; using fallback', err?.response?.data || err);

    return buildFallbackQuote({
      product,
      country: country || 'US',
      currency,
    });
  }
}