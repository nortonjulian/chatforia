import axiosClient from '@/api/axiosClient';

/**
 * Fetch a pricing quote for the current user/region.
 * @param {Object} [opts]
 * @param {string} [opts.country]  - ISO 3166-1 alpha-2 (e.g., "US")
 * @param {string} [opts.currency] - ISO 4217 (e.g., "USD")
 * @param {string} [opts.product]  - Defaults to "chatforia_premium"
 * @returns {Promise<object>} { regionTier, currency, unitAmount, stripePriceId, appleSku, googleSku, ... }
 */
export async function getPricingQuote(opts = {}) {
  const { country, currency, product = 'chatforia_premium' } = opts;
  const { data } = await axiosClient.get('/pricing/quote', {
    params: { product, country, currency },
  });
  return data;
}
