//// Usage (from server root, with env loaded):
//   node prisma/syncStripePrices.js
//
// Prereqs:
// - STRIPE_SECRET_KEY set in your environment
// - Stripe products already created for each logical product below,
//   and their IDs set in the corresponding STRIPE_PROD_* env vars.

import { PrismaClient } from '@prisma/client';
import Stripe from 'stripe';
import { fileURLToPath } from 'url';

const prisma = new PrismaClient();

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: '2023-10-16',
});

// Map your internal product slugs -> Stripe product + billing config.
// Fill these env vars once (just 6–9 products), then this script
// can create ALL the prices for all currencies/tiers.
const PRODUCT_CONFIG = {
  // App subscriptions
  chatforia_plus: {
    stripeProductId: process.env.STRIPE_PROD_CHATFORIA_PLUS,
    type: 'recurring',
    interval: 'month',
  },
  chatforia_premium_monthly: {
    stripeProductId: process.env.STRIPE_PROD_CHATFORIA_PREMIUM_M,
    type: 'recurring',
    interval: 'month',
  },
  chatforia_premium_annual: {
    stripeProductId: process.env.STRIPE_PROD_CHATFORIA_PREMIUM_Y,
    type: 'recurring',
    interval: 'year',
  },

  // One-time mobile eSIM data packs
  chatforia_mobile_small: {
    stripeProductId: process.env.STRIPE_PROD_MOBILE_SMALL,
    type: 'one_time',
  },
  chatforia_mobile_medium: {
    stripeProductId: process.env.STRIPE_PROD_MOBILE_MEDIUM,
    type: 'one_time',
  },
  chatforia_mobile_large: {
    stripeProductId: process.env.STRIPE_PROD_MOBILE_LARGE,
    type: 'one_time',
  },

  // One-time family shared data packs
  chatforia_family_small: {
    stripeProductId: process.env.STRIPE_PROD_FAMILY_SMALL,
    type: 'one_time',
  },
  chatforia_family_medium: {
    stripeProductId: process.env.STRIPE_PROD_FAMILY_MEDIUM,
    type: 'one_time',
  },
  chatforia_family_large: {
    stripeProductId: process.env.STRIPE_PROD_FAMILY_LARGE,
    type: 'one_time',
  },
};

async function main() {
  if (!process.env.STRIPE_SECRET_KEY) {
    throw new Error('STRIPE_SECRET_KEY is not set');
  }

  console.log('🔍 Fetching Price rows without stripePriceId...');
  const dbPrices = await prisma.price.findMany({
    where: {
      active: true,
      stripePriceId: null,
    },
  });

  if (dbPrices.length === 0) {
    console.log('✅ No prices need syncing. All active prices already have Stripe IDs.');
    return;
  }

  console.log(`Found ${dbPrices.length} price rows to sync.`);

  for (const row of dbPrices) {
    const { product, tier, currency, unitAmount } = row;
    const config = PRODUCT_CONFIG[product];

    if (!config) {
      console.warn(
        `⚠️  No PRODUCT_CONFIG entry for product "${product}". ` +
          `Skipping (tier=${tier}, currency=${currency}).`
      );
      continue;
    }

    if (!config.stripeProductId) {
      console.warn(
        `⚠️  Missing stripeProductId env var for product "${product}". ` +
          `Set STRIPE_PROD_* and re-run. Skipping (tier=${tier}, currency=${currency}).`
      );
      continue;
    }

    const cur = currency.toLowerCase();
    const nickname = `${product}_${tier}_${currency}`;

    const priceCreatePayload = {
      product: config.stripeProductId,
      currency: cur,
      unit_amount: unitAmount,
      nickname,
      metadata: {
        product,
        tier,
        currency,
      },
    };

    if (config.type === 'recurring') {
      priceCreatePayload.recurring = {
        interval: config.interval || 'month',
      };
    }

    console.log(
      `➡️  Creating Stripe price for ${product} [tier=${tier}, currency=${currency}, amount=${unitAmount}]`
    );

    try {
      const stripePrice = await stripe.prices.create(priceCreatePayload);

      // Update the existing DB row with the real Stripe price ID
      await prisma.price.update({
        where: {
          product_tier_currency: {
            product,
            tier,
            currency,
          },
        },
        data: {
          stripePriceId: stripePrice.id,
        },
      });

      console.log(`   ✅ Created Stripe price ${stripePrice.id} and updated DB.`);
    } catch (err) {
      console.error(
        `   ❌ Failed to create Stripe price for ${product} [tier=${tier}, currency=${currency}]:`,
        err?.message || err
      );
    }
  }

  console.log('🎉 Done syncing Stripe prices.');
}

const isMain = (() => {
  try {
    return fileURLToPath(import.meta.url) === process.argv[1];
  } catch {
    return false;
  }
})();

if (isMain) {
  main()
    .catch((e) => {
      console.error(e);
      process.exitCode = 1;
    })
    .finally(async () => {
      await prisma.$disconnect();
    });
}

export { main as syncStripePrices };
