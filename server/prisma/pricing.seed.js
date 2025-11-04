// prisma/seed/pricing.seed.js
// Prereqs in your Prisma schema:
// 1) model RegionRule { countryCode String @id @db.VarChar(2) tier String }
// 2) model Price {
//      id          Int     @id @default(autoincrement())
//      product     String
//      tier        String   // e.g. "T1" | "T2" | "T3" | "T4" | "ROW"
//      currency    String
//      unitAmount  Int      // smallest currency unit
//      active      Boolean  @default(true)
//      stripePriceId String?
//      appleSku      String?
//      googleSku     String?
//      @@unique([product, tier, currency], name: "product_tier_currency")
//    }

import { PrismaClient } from '@prisma/client';
import { fileURLToPath } from 'url';

const prisma = new PrismaClient();

// Helper: quick upsert for a (product, tier, currency) price row
async function upsertPrice(p) {
  const {
    product,
    tier,        // "T1" | "T2" | "T3" | "T4" | "ROW"
    currency,    // e.g. "USD"
    unitAmount,  // in minor units
    stripePriceId = null,
    appleSku = null,
    googleSku = null,
  } = p;

  await prisma.price.upsert({
    where: { product_tier_currency: { product, tier, currency } },
    create: { active: true, product, tier, currency, unitAmount, stripePriceId, appleSku, googleSku },
    update: { active: true, unitAmount, stripePriceId, appleSku, googleSku },
  });
}

export async function seedPricing() {
  // 1) Region rules (country -> tier). Extend as needed.
  const regionEntries = [
    // T1: high income
    { countryCode: 'US', tier: 'T1' },
    { countryCode: 'CA', tier: 'T1' },
    { countryCode: 'GB', tier: 'T1' },
    { countryCode: 'IE', tier: 'T1' },
    { countryCode: 'DE', tier: 'T1' },
    { countryCode: 'FR', tier: 'T1' },
    { countryCode: 'NL', tier: 'T1' },
    { countryCode: 'SE', tier: 'T1' },
    { countryCode: 'NO', tier: 'T1' },
    { countryCode: 'DK', tier: 'T1' },
    { countryCode: 'FI', tier: 'T1' },
    { countryCode: 'CH', tier: 'T1' },
    { countryCode: 'AU', tier: 'T1' },
    { countryCode: 'NZ', tier: 'T1' },
    { countryCode: 'JP', tier: 'T1' },
    { countryCode: 'KR', tier: 'T1' },
    { countryCode: 'SG', tier: 'T1' },
    // T2: mid-high
    { countryCode: 'PL', tier: 'T2' },
    { countryCode: 'CZ', tier: 'T2' },
    { countryCode: 'PT', tier: 'T2' },
    { countryCode: 'ES', tier: 'T2' },
    { countryCode: 'IT', tier: 'T2' },
    { countryCode: 'ZA', tier: 'T2' },
    { countryCode: 'MX', tier: 'T2' },
    { countryCode: 'CL', tier: 'T2' },
    { countryCode: 'AR', tier: 'T2' },
    { countryCode: 'AE', tier: 'T2' },
    // T3: large emerging
    { countryCode: 'IN', tier: 'T3' },
    { countryCode: 'BR', tier: 'T3' },
    { countryCode: 'PH', tier: 'T3' },
    { countryCode: 'TH', tier: 'T3' },
    { countryCode: 'VN', tier: 'T3' },
    { countryCode: 'ID', tier: 'T3' },
    { countryCode: 'TR', tier: 'T3' },
    { countryCode: 'CO', tier: 'T3' },
    { countryCode: 'PE', tier: 'T3' },
    // T4: low-income
    { countryCode: 'NG', tier: 'T4' },
    { countryCode: 'KE', tier: 'T4' },
    { countryCode: 'EG', tier: 'T4' },
    { countryCode: 'PK', tier: 'T4' },
    { countryCode: 'BD', tier: 'T4' },
  ];

  await Promise.all(
    regionEntries.map((r) =>
      prisma.regionRule.upsert({
        where: { countryCode: r.countryCode },
        create: r,
        update: { tier: r.tier },
      })
    )
  );

  // 2) Prices by tier + currency (starter matrix)
  const product = 'chatforia_premium';

  // T1
  await upsertPrice({ product, tier: 'T1', currency: 'USD', unitAmount: 999,  stripePriceId: 'price_cf_t1_usd_999' });
  await upsertPrice({ product, tier: 'T1', currency: 'EUR', unitAmount: 999,  stripePriceId: 'price_cf_t1_eur_999' });
  await upsertPrice({ product, tier: 'T1', currency: 'GBP', unitAmount: 899,  stripePriceId: 'price_cf_t1_gbp_899' });
  await upsertPrice({ product, tier: 'T1', currency: 'AUD', unitAmount: 1499, stripePriceId: 'price_cf_t1_aud_1499' });
  await upsertPrice({ product, tier: 'T1', currency: 'JPY', unitAmount: 980,  stripePriceId: 'price_cf_t1_jpy_980' });

  // T2
  await upsertPrice({ product, tier: 'T2', currency: 'ZAR', unitAmount: 9900, stripePriceId: 'price_cf_t2_zar_9900' });
  await upsertPrice({ product, tier: 'T2', currency: 'MXN', unitAmount: 9900, stripePriceId: 'price_cf_t2_mxn_9900' });
  await upsertPrice({ product, tier: 'T2', currency: 'PLN', unitAmount: 2999, stripePriceId: 'price_cf_t2_pln_2999' });
  await upsertPrice({ product, tier: 'T2', currency: 'EUR', unitAmount: 799,  stripePriceId: 'price_cf_t2_eur_799' });

  // T3
  await upsertPrice({ product, tier: 'T3', currency: 'INR', unitAmount: 39900, stripePriceId: 'price_cf_t3_inr_39900' });
  await upsertPrice({ product, tier: 'T3', currency: 'BRL', unitAmount: 1990,  stripePriceId: 'price_cf_t3_brl_1990' });
  await upsertPrice({ product, tier: 'T3', currency: 'PHP', unitAmount: 14900, stripePriceId: 'price_cf_t3_php_14900' });
  await upsertPrice({ product, tier: 'T3', currency: 'THB', unitAmount: 12900, stripePriceId: 'price_cf_t3_thb_12900' });

  // T4
  await upsertPrice({ product, tier: 'T4', currency: 'NGN', unitAmount: 120000, stripePriceId: 'price_cf_t4_ngn_120000' });
  await upsertPrice({ product, tier: 'T4', currency: 'EGP', unitAmount: 7900,   stripePriceId: 'price_cf_t4_egp_7900' });
  await upsertPrice({ product, tier: 'T4', currency: 'KES', unitAmount: 29900,  stripePriceId: 'price_cf_t4_kes_29900' });

  // ROW fallback (USD)
  await upsertPrice({ product, tier: 'ROW', currency: 'USD', unitAmount: 899, stripePriceId: 'price_cf_row_usd_899' });

  console.log('✅ Pricing seeds completed');
}

const isMain = (() => {
  try {
    return fileURLToPath(import.meta.url) === process.argv[1];
  } catch {
    return false;
  }
})();

if (isMain) {
  seedPricing()
    .catch((e) => {
      console.error(e);
      process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
}
