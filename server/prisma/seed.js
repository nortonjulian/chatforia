import 'dotenv/config';
import './seedTranslations.js';
import './seedDevData.js';

async function main() {
  console.log('🌱 Running master seed...');

  // 1️⃣ Seed translations
  console.log('🌍 Seeding translations...');
  await import('./seedTranslations.js');

  // 2️⃣ Seed dev chat data
  console.log('💬 Seeding dev chat data...');
  await import('./seedDevData.js');

  console.log('✅ Master seed complete.');
}

main().catch((e) => {
  console.error('❌ Master seed failed:', e);
  process.exit(1);
});
