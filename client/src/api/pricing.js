import axiosClient from '@/api/axiosClient';

/**
 * Fetch a pricing quote for the current user/region.
 *
 * Usage:
 *   getPricingQuote({ product: 'chatforia_plus' })
 *   getPricingQuote({ product: 'chatforia_premium_monthly' })
 *   getPricingQuote({ product: 'chatforia_premium_annual' })
 *   getPricingQuote({ product: 'chatforia_mobile_small' })
 *   getPricingQuote({ product: 'chatforia_family_large' })
 *
 * @param {Object} [opts]
 * @param {string} [opts.country]  - ISO 3166-1 alpha-2 (e.g., "US")
 * @param {string} [opts.currency] - ISO 4217 (e.g., "USD")
 * @param {string} [opts.product]  - Defaults to "chatforia_premium_monthly"
 * @returns {Promise<object|null>} Quote or null if unavailable
 */

// Hard-coded safety net for UI formatting if the quote API fails
const FALLBACKS = {
  // App plans (subscriptions)
  chatforia_plus: {
    currency: 'USD',
    unitAmount: 499, // $4.99 / mo
  },
  chatforia_premium_monthly: {
    currency: 'USD',
    unitAmount: 2499, // $24.99 / mo
  },
  chatforia_premium_annual: {
    currency: 'USD',
    unitAmount: 22500, // $225 / year
  },

  // Mobile (eSIM) data packs — one time
  chatforia_mobile_small: {
    currency: 'USD',
    unitAmount: 999, // $9.99
  },
  chatforia_mobile_medium: {
    currency: 'USD',
    unitAmount: 1499, // $14.99
  },
  chatforia_mobile_large: {
    currency: 'USD',
    unitAmount: 2499, // $24.99
  },

  // Family shared data packs — one time
  chatforia_family_small: {
    currency: 'USD',
    unitAmount: 2999, // $29.99
  },
  chatforia_family_medium: {
    currency: 'USD',
    unitAmount: 4999, // $49.99
  },
  chatforia_family_large: {
    currency: 'USD',
    unitAmount: 7999, // $79.99
  },
};

export async function getPricingQuote(opts = {}) {
  const { country, currency, product = 'chatforia_premium_monthly' } = opts;

  console.log('[getPricingQuote] called with', { product, country, currency });

  try {
    // IMPORTANT: no extra /api here – axiosClient already has baseURL, e.g. "/api"
    const { data } = await axiosClient.get('/pricing/quote', {
      params: { product, country, currency },
    });
    console.log('[getPricingQuote] success', data);
    return data;
  } catch (err) {
    console.error('[getPricingQuote] failed; using fallback', err);

    const fb = FALLBACKS[product];
    if (!fb) return null;

    const curr = fb.currency || 'USD';
    const amt = fb.unitAmount ?? 0;

    const isZeroDecimal = ['JPY', 'KRW', 'CLP', 'VND', 'IDR'].includes(curr);
    const divisor = isZeroDecimal ? 1 : 100;

    return {
      product,
      country: country || 'US',
      regionTier: 'ROW',
      currency: curr,
      unitAmount: amt,
      stripePriceId: null,
      appleSku: null,
      googleSku: null,
      display: {
        amount: (amt / divisor).toString(),
        currency: curr,
      },
    };
  }
}
