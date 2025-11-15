import { beforeEach, afterAll, jest } from '@jest/globals';

/**
 * beforeEach:
 * Always clear Jest mocks so tests don't leak call history or spies.
 * Do NOT import prisma here.
 */
beforeEach(() => {
  jest.clearAllMocks();
});


afterAll(() => {
  jest.resetModules();
});

/**
 * afterAll:
 * Best-effort Prisma disconnect.
 *
 * We only attempt this at the very end of the entire Jest run, and we wrap it
 * in a try/catch so tests that never import prismaClient.js won't fail.
 */
afterAll(async () => {
  try {
    // path is relative to THIS file's location
    const prismaModule = await import('../utils/prismaClient.js');
    const prisma =
      prismaModule.prisma || prismaModule.default || prismaModule;

    if (prisma?.$disconnect) {
      await prisma.$disconnect();
    }
  } catch {
    // swallow:
    // - prismaClient.js may not exist in certain mock-heavy tests
    // - or it may never have been imported at all
  }
});
