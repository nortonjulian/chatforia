import prisma from '../utils/prismaClient.js';

/**
 * Look up region tier for a country (T1/T2/T3/T4/ROW).
 */
export async function getTierForCountry(countryCode) {
  if (!countryCode) return 'ROW';
  const cc = countryCode.toUpperCase();

  const rule = await prisma.regionRule.findUnique({
    where: { countryCode: cc },
  });

  return rule?.tier || 'ROW';
}

/**
 * Get an active Price row for a given product + tier.
 * Falls back to ROW/USD if there is no tier-specific price or the price
 * doesn’t have a Stripe ID yet.
 */
export async function getPriceForProductAndTier(product, tier) {
  // Try tier-specific price first
  let price = await prisma.price.findFirst({
    where: {
      product,
      tier,
      active: true,
      stripePriceId: { not: null },
    },
  });

  // Fallback: ROW/USD (global default)
  if (!price) {
    price = await prisma.price.findFirst({
      where: {
        product,
        tier: 'ROW',
        currency: 'USD',
        active: true,
        stripePriceId: { not: null },
      },
    });
  }

  if (!price) {
    throw new Error(`No active price configured for product=${product}, tier=${tier}`);
  }

  return price; // { product, tier, currency, unitAmount, stripePriceId, ... }
}
