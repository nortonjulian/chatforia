import { beforeEach, afterAll, jest } from '@jest/globals';
import prismaRaw from '../utils/prismaClient.js';

const prisma = prismaRaw.default || prismaRaw;

async function wipeDatabase() {
  // CHILD TABLES FIRST, PARENTS LAST.
  // Anything that FK's something else needs to be deleted before that something else.

  // --- STATUS FEATURE ---
  // These likely FK Status or User or both
  await prisma.statusReaction?.deleteMany?.();
  await prisma.statusView?.deleteMany?.();
  await prisma.statusKey?.deleteMany?.();
  await prisma.statusAsset?.deleteMany?.();
  await prisma.status?.deleteMany?.();

  // --- MESSAGING / CHAT ---
  // Messages usually FK userId and chatRoomId
  await prisma.message?.deleteMany?.();

  // Participant links user <-> chatRoom
  await prisma.participant?.deleteMany?.();

  // --- PER-USER AUXILIARY TABLES ---
  // Transcript FK's userId (your error showed Transcript_userId_fkey)
  await prisma.transcript?.deleteMany?.();

  // If you have other per-user tables (quotaUsage, session, tokens, etc.),
  // they go here too, ABOVE user.deleteMany().

  // --- ROOMS ---
  await prisma.chatRoom?.deleteMany?.();

  // --- USERS LAST ---
  await prisma.user?.deleteMany?.();
}

// THIS MUST BE beforeEach, not beforeAll.
beforeEach(async () => {
  await wipeDatabase();
  jest.clearAllMocks();
  // DO NOT call jest.resetModules() here.
});

// Close prisma after the whole suite (once)
afterAll(async () => {
  try {
    const prismaModule = await import('../utils/prismaClient.js');
    const prismaMaybe =
      prismaModule.default ||
      prismaModule.prisma ||
      prismaModule;

    if (prismaMaybe?.$disconnect) {
      await prismaMaybe.$disconnect();
    }
  } catch {
    // swallow to avoid noisy shutdown
  }
});
