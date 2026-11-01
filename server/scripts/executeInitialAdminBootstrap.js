/**
 * One-time infrastructure-only administrator promotion CLI.
 *
 * Never imported by application startup or HTTP routes.
 * Requires manual execution by an authorized infrastructure operator.
 */
import { PrismaClient } from '@prisma/client';
import { stdin, stdout } from 'node:process';

import {
  executeInitialAdminPromotion,
} from './initialAdminExecutionCoordinator.js';

async function main() {
  if (
    process.argv.length !== 3 ||
    process.argv[2] !== '--execute'
  ) {
    throw new Error('Explicit --execute argument required');
  }

  if (process.env.NODE_ENV !== 'production') {
    throw new Error('Production environment required');
  }

  if (!stdin.isTTY || !stdout.isTTY) {
    throw new Error('Interactive terminal required');
  }

  const databaseUrl = process.env.DATABASE_URL;

  if (!databaseUrl) {
    throw new Error('Database configuration unavailable');
  }

  const prisma = new PrismaClient({
    datasources: { db: { url: databaseUrl } },
  });

  try {
    const result = await executeInitialAdminPromotion({
      prisma,
      databaseUrl,
      nodeEnv: process.env.NODE_ENV,
    });

    if (
      result.mode !== 'executed' ||
      result.role !== 'ADMIN' ||
      result.sessionsRevoked !== true ||
      result.verified !== true
    ) {
      throw new Error('Unexpected administrator promotion result');
    }

    console.log('PASS: Company administrator promotion completed.');
    console.log('Account:', result.email);
    console.log('Role:', result.role);
    console.log('Existing sessions revoked:', result.sessionsRevoked);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch(() => {
  console.error('STOP: Administrator promotion failed.');
  process.exitCode = 1;
});
