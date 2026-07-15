import Stripe from 'stripe';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const applyChanges = process.argv.includes('--apply');

const stripeSecretKey =
  String(process.env.STRIPE_SECRET_KEY || '').trim();

if (!stripeSecretKey) {
  throw new Error('STRIPE_SECRET_KEY is not configured');
}

const stripe = new Stripe(stripeSecretKey);

const ESIM_PRICES = [
  // Local
  {
    product: 'chatforia_esim_local_3',
    envName: 'STRIPE_PRICE_ESIM_LOCAL_3',
  },
  {
    product: 'chatforia_esim_local_5',
    envName: 'STRIPE_PRICE_ESIM_LOCAL_5',
  },
  {
    product: 'chatforia_esim_local_10',
    envName: 'STRIPE_PRICE_ESIM_LOCAL_10',
  },
  {
    product: 'chatforia_esim_local_20',
    envName: 'STRIPE_PRICE_ESIM_LOCAL_20',
  },
  {
    product: 'chatforia_esim_local_unlimited',
    envName: 'STRIPE_PRICE_ESIM_LOCAL_UNLIMITED',
  },

  // Europe
  {
    product: 'chatforia_esim_europe_3',
    envName: 'STRIPE_PRICE_ESIM_EUROPE_3',
  },
  {
    product: 'chatforia_esim_europe_5',
    envName: 'STRIPE_PRICE_ESIM_EUROPE_5',
  },
  {
    product: 'chatforia_esim_europe_10',
    envName: 'STRIPE_PRICE_ESIM_EUROPE_10',
  },
  {
    product: 'chatforia_esim_europe_20',
    envName: 'STRIPE_PRICE_ESIM_EUROPE_20',
  },
  {
    product: 'chatforia_esim_europe_unlimited',
    envName: 'STRIPE_PRICE_ESIM_EUROPE_UNLIMITED',
  },

  // Global
  {
    product: 'chatforia_esim_global_3',
    envName: 'STRIPE_PRICE_ESIM_GLOBAL_3',
  },
  {
    product: 'chatforia_esim_global_5',
    envName: 'STRIPE_PRICE_ESIM_GLOBAL_5',
  },
  {
    product: 'chatforia_esim_global_10',
    envName: 'STRIPE_PRICE_ESIM_GLOBAL_10',
  },
  {
    product: 'chatforia_esim_global_unlimited',
    envName: 'STRIPE_PRICE_ESIM_GLOBAL_UNLIMITED',
  },
];

function requiredEnvironmentValue(name) {
  const value = String(process.env[name] || '').trim();

  if (!value) {
    throw new Error(`${name} is not configured`);
  }

  return value;
}

function formattedAmount(unitAmount, currency) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
  }).format(unitAmount / 100);
}

async function resolveStripePrices() {
  const configured = ESIM_PRICES.map((entry) => ({
    ...entry,
    stripePriceId: requiredEnvironmentValue(entry.envName),
  }));

  const uniqueIds = new Set(
    configured.map((entry) => entry.stripePriceId)
  );

  if (uniqueIds.size !== configured.length) {
    throw new Error(
      'Two or more eSIM products are configured with the same Stripe Price ID'
    );
  }

  const resolved = [];

  for (const entry of configured) {
    const stripePrice = await stripe.prices.retrieve(
      entry.stripePriceId
    );

    if (!stripePrice.active) {
      throw new Error(
        `${entry.envName} points to an inactive Stripe Price`
      );
    }

    if (stripePrice.type !== 'one_time') {
      throw new Error(
        `${entry.envName} must point to a one-time Stripe Price`
      );
    }

    if (!Number.isInteger(stripePrice.unit_amount)) {
      throw new Error(
        `${entry.envName} does not have an integer unit_amount`
      );
    }

    const currency =
      String(stripePrice.currency || '').toUpperCase();

    if (currency !== 'USD') {
      throw new Error(
        `${entry.envName} uses ${currency}; the current quote rows require USD`
      );
    }

    resolved.push({
      product: entry.product,
      envName: entry.envName,
      stripePriceId: stripePrice.id,
      unitAmount: stripePrice.unit_amount,
      currency,
      active: stripePrice.active,
      displayAmount: formattedAmount(
        stripePrice.unit_amount,
        currency
      ),
    });
  }

  return resolved;
}

async function ensurePriceIdsAreSafe(resolved) {
  const expectedByPriceId = new Map(
    resolved.map((entry) => [
      entry.stripePriceId,
      entry.product,
    ])
  );

  const existingOwners = await prisma.price.findMany({
    where: {
      stripePriceId: {
        in: resolved.map(
          (entry) => entry.stripePriceId
        ),
      },
    },
    select: {
      product: true,
      tier: true,
      currency: true,
      stripePriceId: true,
    },
  });

  for (const row of existingOwners) {
    const expectedProduct =
      expectedByPriceId.get(row.stripePriceId);

    if (
      expectedProduct &&
      row.product !== expectedProduct
    ) {
      throw new Error(
        `Stripe Price ${row.stripePriceId} is already assigned to ${row.product}, not ${expectedProduct}`
      );
    }
  }
}

async function applyPriceRows(resolved) {
  await prisma.$transaction(async (tx) => {
    for (const entry of resolved) {
      await tx.price.upsert({
        where: {
          product_tier_currency: {
            product: entry.product,
            tier: 'ROW',
            currency: entry.currency,
          },
        },
        update: {
          unitAmount: entry.unitAmount,
          stripePriceId: entry.stripePriceId,
          active: true,
        },
        create: {
          product: entry.product,
          tier: 'ROW',
          currency: entry.currency,
          unitAmount: entry.unitAmount,
          stripePriceId: entry.stripePriceId,
          active: true,
        },
      });
    }
  });
}

async function main() {
  const resolved = await resolveStripePrices();

  await ensurePriceIdsAreSafe(resolved);

  console.table(
    resolved.map((entry) => ({
      product: entry.product,
      amount: entry.displayAmount,
      currency: entry.currency,
      stripePriceId: entry.stripePriceId,
    }))
  );

  if (!applyChanges) {
    console.log(
      '\nDRY RUN ONLY — no database rows were changed.'
    );
    console.log(
      'Run again with --apply after reviewing all 14 prices.'
    );

    return;
  }

  await applyPriceRows(resolved);

  const savedRows = await prisma.price.findMany({
    where: {
      product: {
        in: resolved.map((entry) => entry.product),
      },
      tier: 'ROW',
      currency: 'USD',
      active: true,
    },
    orderBy: {
      product: 'asc',
    },
  });

  console.log(
    `\nApplied ${savedRows.length} active ROW/USD eSIM price rows.`
  );

  if (savedRows.length !== ESIM_PRICES.length) {
    throw new Error(
      `Expected ${ESIM_PRICES.length} saved rows but found ${savedRows.length}`
    );
  }
}

try {
  await main();
} catch (error) {
  console.error('\nPrice synchronization failed:');
  console.error(error);

  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
