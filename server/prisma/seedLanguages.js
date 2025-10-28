// import { PrismaClient } from '@prisma/client';
// const prisma = new PrismaClient();

// import { LANGUAGES } from '../routes/languages.js';

// async function main() {
//   for (const lang of LANGUAGES) {
//     await prisma.language.upsert({
//       where: { code: lang.code },
//       update: {},
//       create: {
//         code: lang.code,
//         displayName: lang.name,
//       },
//     });
//   }
//   console.log('🌍 Languages seeded!');
// }

// main()
//   .catch((e) => {
//     console.error(e);
//     process.exit(1);
//   })
//   .finally(() => prisma.$disconnect());


import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

const EN_STRINGS = {
  'profile.preferredLanguage': 'Preferred language',
  'profile.chooseLanguage': 'Choose your language',
  'common.noMatches': 'No matches',
  'profile.autoTranslate': 'Auto-translate messages',
  'profile.showOriginal': 'Show original alongside translation',
  'profile.readReceipts': 'Enable read receipts',
};

async function main() {
  for (const [key, value] of Object.entries(EN_STRINGS)) {
    await prisma.translation.upsert({
      where: {
        language_key: { language: 'en', key },
      },
      update: { value },
      create: {
        language: 'en',
        key,
        value,
      },
    });
  }

  console.log('✅ Seeded base English UI strings');
}

main()
  .catch(err => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());