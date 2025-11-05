import axiosClient from '@/api/axiosClient';

/**
 * Fetch a pricing quote for the current user/region.
 *
 * Usage:
 *   // Plus:
 *   getPricingQuote({ product: 'chatforia_plus' })
 *   // Premium monthly:
 *   getPricingQuote({ product: 'chatforia_premium_monthly' })
 *   // Premium annual:
 *   getPricingQuote({ product: 'chatforia_premium_annual' })
 *
 * @param {Object} [opts]
 * @param {string} [opts.country]  - ISO 3166-1 alpha-2 (e.g., "US")
 * @param {string} [opts.currency] - ISO 4217 (e.g., "USD")
 * @param {string} [opts.product]  - Defaults to "chatforia_premium_monthly"
 * @returns {Promise<object>} { product, country, regionTier, currency, unitAmount, stripePriceId, appleSku, googleSku, display: { amount, currency } }
 */
export async function getPricingQuote(opts = {}) {
  const { country, currency, product = 'chatforia_premium_monthly' } = opts;
  const { data } = await axiosClient.get('/pricing/quote', {
    params: { product, country, currency },
  });
  return data;
}
