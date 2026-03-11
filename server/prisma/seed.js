import 'dotenv/config';
import { seedTranslations } from './seedTranslations.js';
import { seedDevData } from './seedDevData.js';

async function main() {
  console.log('🌱 Running master seed...');

  console.log('🌍 Seeding translations...');
  await seedTranslations();

  console.log('💬 Seeding dev chat data...');
  await seedDevData();

  console.log('✅ Master seed complete.');
}

main()
  .catch((e) => {
    console.error('❌ Master seed failed:', e);
    process.exit(1);
  });