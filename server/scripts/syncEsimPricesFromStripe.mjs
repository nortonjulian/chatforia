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
  { product: 'chatforia_esim_local_3', envName: 'STRIPE_PRICE_ESIM_LOCAL_3', expectedUnitAmount: 999 },
  { product: 'chatforia_esim_local_5', envName: 'STRIPE_PRICE_ESIM_LOCAL_5', expectedUnitAmount: 1499 },
  { product: 'chatforia_esim_local_10', envName: 'STRIPE_PRICE_ESIM_LOCAL_10', expectedUnitAmount: 2499 },
  { product: 'chatforia_esim_local_20', envName: 'STRIPE_PRICE_ESIM_LOCAL_20', expectedUnitAmount: 3999 },
  { product: 'chatforia_esim_local_unlimited', envName: 'STRIPE_PRICE_ESIM_LOCAL_UNLIMITED', expectedUnitAmount: 5999 },

  // Europe
  { product: 'chatforia_esim_europe_3', envName: 'STRIPE_PRICE_ESIM_EUROPE_3', expectedUnitAmount: 1299 },
  { product: 'chatforia_esim_europe_5', envName: 'STRIPE_PRICE_ESIM_EUROPE_5', expectedUnitAmount: 1999 },
  { product: 'chatforia_esim_europe_10', envName: 'STRIPE_PRICE_ESIM_EUROPE_10', expectedUnitAmount: 3299 },
  { product: 'chatforia_esim_europe_20', envName: 'STRIPE_PRICE_ESIM_EUROPE_20', expectedUnitAmount: 4999 },
  { product: 'chatforia_esim_europe_unlimited', envName: 'STRIPE_PRICE_ESIM_EUROPE_UNLIMITED', expectedUnitAmount: 6999 },

  // Global — no 20GB at launch
  { product: 'chatforia_esim_global_3', envName: 'STRIPE_PRICE_ESIM_GLOBAL_3', expectedUnitAmount: 2199 },
  { product: 'chatforia_esim_global_5', envName: 'STRIPE_PRICE_ESIM_GLOBAL_5', expectedUnitAmount: 3299 },
  { product: 'chatforia_esim_global_10', envName: 'STRIPE_PRICE_ESIM_GLOBAL_10', expectedUnitAmount: 4999 },
  { product: 'chatforia_esim_global_unlimited', envName: 'STRIPE_PRICE_ESIM_GLOBAL_UNLIMITED', expectedUnitAmount: 7999 },
];

const ESIM_TIERS = ['T1', 'T2', 'T3', 'T4', 'ROW'];

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

    if (stripePrice.unit_amount !== entry.expectedUnitAmount) {
      throw new Error(
        `${entry.envName} has ${formattedAmount(
          stripePrice.unit_amount,
          currency
        )}; expected ${formattedAmount(
          entry.expectedUnitAmount,
          currency
        )}`
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

async function ensureNoActiveNonUsdRows() {
  const rows = await prisma.price.findMany({
    where: {
      product: {
        in: ESIM_PRICES.map((entry) => entry.product),
      },
      active: true,
      NOT: {
        currency: 'USD',
      },
    },
    select: {
      product: true,
      tier: true,
      currency: true,
      unitAmount: true,
    },
  });

  if (rows.length > 0) {
    console.table(rows);
    throw new Error(
      'Active non-USD eSIM Price rows exist and could override the canonical launch USD matrix'
    );
  }
}

async function applyPriceRows(resolved) {
  await prisma.$transaction(async (tx) => {
    // Tier rows are quote-only. Stripe ID remains canonical on ROW/USD.
    for (const entry of resolved) {
      for (const tier of ESIM_TIERS.filter((value) => value !== 'ROW')) {
        await tx.price.upsert({
          where: {
            product_tier_currency: {
              product: entry.product,
              tier,
              currency: entry.currency,
            },
          },
          update: {
            unitAmount: entry.unitAmount,
            stripePriceId: null,
            active: true,
          },
          create: {
            product: entry.product,
            tier,
            currency: entry.currency,
            unitAmount: entry.unitAmount,
            stripePriceId: null,
            active: true,
          },
        });
      }
    }

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
  await ensureNoActiveNonUsdRows();

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
      tier: {
        in: ESIM_TIERS,
      },
      currency: 'USD',
      active: true,
    },
    orderBy: [
      { product: 'asc' },
      { tier: 'asc' },
    ],
  });

  const expectedRowCount =
    ESIM_PRICES.length * ESIM_TIERS.length;

  console.log(
    `\nApplied ${savedRows.length} active USD eSIM price rows across ${ESIM_TIERS.length} tiers.`
  );

  if (savedRows.length !== expectedRowCount) {
    throw new Error(
      `Expected ${expectedRowCount} saved rows but found ${savedRows.length}`
    );
  }

  const resolvedByProduct = new Map(
    resolved.map((entry) => [entry.product, entry])
  );

  for (const row of savedRows) {
    const expected = resolvedByProduct.get(row.product);

    if (!expected) {
      throw new Error(
        `Unexpected saved eSIM product ${row.product}`
      );
    }

    if (row.unitAmount !== expected.unitAmount) {
      throw new Error(
        `${row.product}/${row.tier} saved ${row.unitAmount}; expected ${expected.unitAmount}`
      );
    }

    if (row.tier === 'ROW') {
      if (row.stripePriceId !== expected.stripePriceId) {
        throw new Error(
          `${row.product}/ROW does not contain the canonical Stripe Price ID`
        );
      }
    } else if (row.stripePriceId !== null) {
      throw new Error(
        `${row.product}/${row.tier} unexpectedly contains a Stripe Price ID`
      );
    }
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
