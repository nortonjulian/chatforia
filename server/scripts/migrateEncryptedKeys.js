import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

function detectDb() {
  const url = process.env.DATABASE_URL || '';
  if (url.startsWith('postgresql://') || url.startsWith('postgres://'))
    return 'postgres';
  if (url.startsWith('file:') || url.includes('sqlite')) return 'sqlite';
  if (url.startsWith('mysql://')) return 'mysql';
  return 'unknown';
}

async function nullOutEncryptedKeys(db) {
  // Optional: set the old column to NULL after migrating
  if (db === 'postgres') {
    await prisma.$executeRawUnsafe(
      `UPDATE "Message" SET "encryptedKeys" = NULL WHERE "encryptedKeys" IS NOT NULL`
    );
  } else if (db === 'sqlite') {
    await prisma.$executeRawUnsafe(
      `UPDATE Message SET encryptedKeys = NULL WHERE encryptedKeys IS NOT NULL`
    );
  } else if (db === 'mysql') {
    await prisma.$executeRawUnsafe(
      `UPDATE Message SET encryptedKeys = NULL WHERE encryptedKeys IS NOT NULL`
    );
  }
}

async function main() {
  const db = detectDb();
  console.log(`DB detected: ${db}`);

  // sanity check: ensure MessageKey table exists
  await prisma.messageKey.count();

  // ---- guarded legacy fetch ----
  let rows = [];
  try {
    if (db === 'postgres') {
      rows = await prisma.$queryRawUnsafe(
        `SELECT id, "encryptedKeys" FROM "Message" WHERE "encryptedKeys" IS NOT NULL`
      );
    } else if (db === 'sqlite') {
      rows = await prisma.$queryRawUnsafe(
        `SELECT id, encryptedKeys FROM Message WHERE encryptedKeys IS NOT NULL`
      );
    } else if (db === 'mysql') {
      rows = await prisma.$queryRawUnsafe(
        `SELECT id, encryptedKeys FROM Message WHERE encryptedKeys IS NOT NULL`
      );
    } else {
      throw new Error('Unsupported/unknown database provider for raw SQL.');
    }
  } catch (e) {
    // Postgres undefined column (Prisma wraps as P2010 with meta.code 42703)
    if (e?.code === 'P2010' && e?.meta?.code === '42703') {
      console.log('No legacy encryptedKeys column found. Nothing to migrate.');
      process.exit(0);
    }
    // SQLite/MySQL might throw different shapes. If it looks like "no such column", exit gracefully.
    if (
      String(e?.message || '').toLowerCase().includes('no such column') ||
      String(e?.message || '').toLowerCase().includes('unknown column')
    ) {
      console.log('No legacy encryptedKeys column found. Nothing to migrate.');
      process.exit(0);
    }
    throw e;
  }
  // -----------------------------

  console.log(`Found ${rows.length} messages with encryptedKeys`);

  let created = 0;
  for (const row of rows) {
    const { id, encryptedKeys } = row;

    // encryptedKeys may be JSON or stringified JSON
    let map = encryptedKeys;
    if (typeof map === 'string') {
      try {
        map = JSON.parse(map);
      } catch {
        console.warn(
          `Message ${id}: could not parse encryptedKeys as JSON, skipping`
        );
        continue;
      }
    }

    if (!map || typeof map !== 'object') {
      console.warn(`Message ${id}: encryptedKeys is not an object, skipping`);
      continue;
    }

    for (const [userIdStr, encryptedKey] of Object.entries(map)) {
      const userId = Number(userIdStr);

      // ❗ Treat empty keys as invalid + all the existing checks
      if (
        !userIdStr || // empty string → bad
        !Number.isFinite(userId) ||
        typeof encryptedKey !== 'string' ||
        !encryptedKey.length
      ) {
        console.warn(`Message ${id}: bad entry (${userIdStr}), skipping`);
        continue;
      }

      await prisma.messageKey.upsert({
        where: { messageId_userId: { messageId: id, userId } },
        update: { encryptedKey },
        create: { messageId: id, userId, encryptedKey },
      });
      created += 1;
    }
  }

  console.log(`Created/updated ${created} MessageKey rows.`);

  // Optional: clear the legacy column if it exists
  try {
    await nullOutEncryptedKeys(db);
  } catch {
    // ignore if column doesn't exist
  }

  console.log('Done.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
