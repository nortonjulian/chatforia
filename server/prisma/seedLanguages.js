import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

import { LANGUAGES } from '../routes/languages.js';

async function main() {
  for (const lang of LANGUAGES) {
    await prisma.language.upsert({
      where: { code: lang.code },
      update: {},
      create: {
        code: lang.code,
        displayName: lang.name,
      },
    });
  }
  console.log('🌍 Languages seeded!');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
