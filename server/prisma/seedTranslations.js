import fs from 'fs';
import path from 'path';
import prisma from '../utils/prismaClient.js'; // adjust if needed

const LOCALES_DIR = path.resolve('../client/public/locales');

const seed = async () => {
  const languages = fs.readdirSync(LOCALES_DIR).filter((lng) =>
    fs.existsSync(path.join(LOCALES_DIR, lng, 'translation.json'))
  );

  for (const lng of languages) {
    const filepath = path.join(LOCALES_DIR, lng, 'translation.json');
    const raw = fs.readFileSync(filepath, 'utf-8');
    const messages = JSON.parse(raw);

    const flat = flatten(messages); // flatten nested JSON

    for (const [key, value] of Object.entries(flat)) {
      await prisma.translation.upsert({
        where: { language_key: { language: lng, key } },
        update: { value },
        create: { language: lng, key, value },
      });
    }

    console.log(`Seeded ${Object.keys(flat).length} keys for "${lng}"`);
  }

  console.log('✅ All translations seeded.');
  process.exit(0);
};

function flatten(obj, prefix = '') {
  return Object.entries(obj).reduce((acc, [key, val]) => {
    const k = prefix ? `${prefix}.${key}` : key;
    if (typeof val === 'object' && val !== null) {
      Object.assign(acc, flatten(val, k));
    } else {
      acc[k] = val;
    }
    return acc;
  }, {});
}

seed().catch((err) => {
  console.error('❌ Failed to seed translations:', err);
  process.exit(1);
});
