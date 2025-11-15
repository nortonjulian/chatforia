import prisma from '../utils/prismaClient.js';

/**
 * Core logic for backfilling ownerId on chat rooms.
 * Accepts a prisma-like client so tests can inject a mock.
 */
export async function backfillOwnerId(prismaClient = prisma) {
  const rooms = await prismaClient.chatRoom.findMany({
    select: { id: true, ownerId: true },
  });

  let updated = 0;

  for (const r of rooms) {
    if (r.ownerId) continue;

    // Prefer explicit OWNER participant; else first ADMIN; else any participant
    const p = await prismaClient.participant.findFirst({
      where: {
        chatRoomId: r.id,
        role: { in: ['OWNER', 'ADMIN', 'MODERATOR', 'MEMBER'] },
      },
      orderBy: [
        { role: 'asc' }, // OWNER < ADMIN < MODERATOR < MEMBER (lexicographic)
        { id: 'asc' },
      ],
    });

    if (!p) continue; // empty room—skip

    await prismaClient.chatRoom.update({
      where: { id: r.id },
      data: { ownerId: p.userId },
    });
    updated++;
  }

  console.log(`Backfilled ownerId for ${updated} room(s).`);
}

// CLI entrypoint: only run automatically when invoked directly via `node`
if (import.meta.url === `file://${process.argv[1]}`) {
  backfillOwnerId(prisma)
    .catch((e) => {
      console.error(e);
      process.exit(1);
    })
    .finally(() => prisma.$disconnect());
}

export default backfillOwnerId;
