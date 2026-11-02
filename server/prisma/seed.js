import 'dotenv/config';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { seedTranslations } from './seedTranslations.js';
import { seedDevData } from './seedDevData.js';
import {
  assertConnectedDevSeedTarget,
  getDevSeedPassword,
} from './assertDevSeedTarget.js';
import prisma from '../utils/prismaClient.js';

export async function main() {
  getDevSeedPassword();
  await assertConnectedDevSeedTarget(prisma);

  console.log('🌱 Running master seed...');

  console.log('🌍 Seeding translations...');
  await seedTranslations();

  console.log('💬 Seeding dev chat data...');
  await seedDevData();

  console.log('✅ Master seed complete.');
}

export async function runMasterSeed() {
  try {
    await main();
  } finally {
    await prisma.$disconnect();
  }
}

const invokedDirectly =
  Boolean(process.argv[1]) &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invokedDirectly) {
  runMasterSeed().catch((error) => {
    console.error('❌ Master seed failed:', error);
    process.exitCode = 1;
  });
}
