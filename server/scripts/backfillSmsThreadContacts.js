import prisma from '../utils/prismaClient.js';

function digitsOnly(value = '') {
  return String(value).replace(/\D/g, '');
}

function phoneVariants(raw) {
  const cleaned = String(raw || '').trim().replace(/[^\d+]/g, '');
  if (!cleaned) return [];
  const noPlus = cleaned.startsWith('+') ? cleaned.slice(1) : cleaned;
  const withPlus = cleaned.startsWith('+') ? cleaned : `+${cleaned}`;
  return [...new Set([withPlus, noPlus].filter(Boolean))];
}

async function main() {
  console.log('Starting SMS thread contact backfill...');

  const threads = await prisma.smsThread.findMany({
    where: {
      contactId: null,
      deletedAt: null,
    },
    select: {
      id: true,
      userId: true,
      contactPhone: true,
      participants: {
        select: { phone: true },
        take: 10,
      },
    },
    orderBy: { id: 'asc' },
  });

  console.log(`Found ${threads.length} thread(s) with null contactId`);

  let linked = 0;
  let skipped = 0;
  let ambiguous = 0;

  for (const thread of threads) {
    const candidatePhones = [
      thread.contactPhone,
      ...(thread.participants || []).map((p) => p.phone),
    ].filter(Boolean);

    if (!candidatePhones.length) {
      skipped++;
      console.log(`- Thread ${thread.id}: skipped (no phone candidates)`);
      continue;
    }

    const variants = [...new Set(candidatePhones.flatMap(phoneVariants))];
    const variantDigits = [...new Set(variants.map(digitsOnly).filter(Boolean))];

    if (!variants.length && !variantDigits.length) {
      skipped++;
      console.log(`- Thread ${thread.id}: skipped (no normalized variants)`);
      continue;
    }

    const contacts = await prisma.contact.findMany({
      where: {
        ownerId: thread.userId,
        OR: [
          { externalPhone: { in: variants } },
          // fallback in case old rows were stored differently
          ...variantDigits.map((d) => ({
            externalPhone: { contains: d },
          })),
        ],
      },
      select: {
        id: true,
        externalPhone: true,
        alias: true,
        externalName: true,
        user: { select: { username: true } },
      },
    });

    if (contacts.length === 0) {
      skipped++;
      console.log(`- Thread ${thread.id}: no matching contact`);
      continue;
    }

    if (contacts.length > 1) {
      // Prefer exact variant match first
      const exact = contacts.filter((c) => variants.includes(c.externalPhone));
      if (exact.length === 1) {
        const chosen = exact[0];
        await prisma.smsThread.update({
          where: { id: thread.id },
          data: {
            contactId: chosen.id,
            contactPhone: thread.contactPhone || chosen.externalPhone || null,
          },
        });
        linked++;
        console.log(
          `- Thread ${thread.id}: linked to contact ${chosen.id} via exact match`
        );
        continue;
      }

      ambiguous++;
      console.log(
        `- Thread ${thread.id}: ambiguous (${contacts.length} contacts matched), skipped`
      );
      continue;
    }

    const contact = contacts[0];

    await prisma.smsThread.update({
      where: { id: thread.id },
      data: {
        contactId: contact.id,
        contactPhone: thread.contactPhone || contact.externalPhone || null,
      },
    });

    linked++;
    console.log(`- Thread ${thread.id}: linked to contact ${contact.id}`);
  }

  console.log('\nBackfill complete.');
  console.log(`Linked: ${linked}`);
  console.log(`Skipped: ${skipped}`);
  console.log(`Ambiguous: ${ambiguous}`);
}

main()
  .catch((err) => {
    console.error('Backfill failed:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });