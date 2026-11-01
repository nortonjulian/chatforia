/**
 * Read-only production administrator bootstrap inspection.
 *
 * This runner has NO administrator promotion capability.
 * It validates the target environment and account eligibility.
 */
import { PrismaClient } from '@prisma/client';
import { bootstrapInitialAdmin } from './initialAdminBootstrap.js';
import { validateBootstrapEnvironment } from './initialAdminBootstrapGuard.js';

const EXPECTED_DATABASE = 'defaultdb';
const EXPECTED_ENDPOINT_FINGERPRINT =
  '268c88704efff766fae41e45416ac701b302fe6f067b5753a3fafb90e2789bc9';

async function main() {
  if (process.argv.length !== 2) {
    throw new Error('Inspection runner does not accept arguments');
  }

  if (process.env.NODE_ENV !== 'production') {
    throw new Error('Production environment required');
  }

  const databaseUrl = process.env.DATABASE_URL;

  if (!databaseUrl) {
    throw new Error('Database configuration unavailable');
  }

  const prisma = new PrismaClient({
    datasources: { db: { url: databaseUrl } },
  });

  try {
    const rows = await prisma.$queryRaw`
      SELECT current_database() AS database_name,
             current_schema() AS schema_name
    `;

    const row = rows[0];

    validateBootstrapEnvironment({
      nodeEnv: process.env.NODE_ENV,
      databaseUrl,
      expectedDatabase: EXPECTED_DATABASE,
      actualDatabase: row?.database_name,
      actualSchema: row?.schema_name,
      confirmation:
        `PROMOTE julian@chatforia.com ON ${EXPECTED_DATABASE}`,
      expectedEndpointFingerprint: EXPECTED_ENDPOINT_FINGERPRINT,
    });

    const result = await bootstrapInitialAdmin(prisma);

    console.log('=== INITIAL ADMINISTRATOR INSPECTION ===');
    console.log('Account:', result.email);
    console.log('Current role:', result.currentRole);
    console.log('Eligible:', result.eligible);
    console.log('Mode: DRY RUN');
    console.log('PASS: No administrator changes performed.');
  } finally {
    await prisma.$disconnect();
  }
}

main().catch(() => {
  console.error('STOP: Administrator inspection failed.');
  process.exitCode = 1;
});
