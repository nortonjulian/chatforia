import { beforeEach, afterAll, jest } from '@jest/globals';

/**
 * IMPORTANT:
 * We intentionally do NOT wipe the database globally here.
 *
 * Why:
 * - Some unit tests (e.g. resetTokens, tokenStore) fully mock ../utils/prismaClient.js.
 *   Jest runs this file (setupFilesAfterEnv) BEFORE those tests get a chance to
 *   register their jest.unstable_mockModule() mocks.
 *
 *   If we tried to import prismaClient.js here (directly or indirectly by wiping
 *   tables), we'd eagerly load the real Prisma client first, which crashes those tests.
 *
 * Policy:
 * - Lightweight / pure unit tests: they should not pay for DB setup or be forced
 *   to import Prisma at all.
 * - Integration / DB-backed tests: if they need a clean DB, they are responsible
 *   for truncating/wiping tables in their own beforeEach within that test file,
 *   using the real prisma client.
 */

/**
 * beforeEach:
 * Always clear Jest mocks so tests don't leak call history or spies.
 * Do NOT import prisma here.
 */
beforeEach(() => {
  jest.clearAllMocks();
});

/**
 * afterAll:
 * Best-effort Prisma disconnect.
 *
 * We only attempt this at the very end of the entire Jest run, and we wrap it
 * in a try/catch so tests that never import prismaClient.js won't fail.
 *
 * We ALSO import prismaClient.js via a relative path from this file
 * (../utils/prismaClient.js). That path matches how server tests typically
 * import the client, which maximizes the chance that if Prisma WAS imported,
 * we're referring to the same module instance here.
 */
afterAll(async () => {
  try {
    const prismaModule = await import('../utils/prismaClient.js');
    const prisma =
      prismaModule.default || prismaModule.prisma || prismaModule;

    if (prisma?.$disconnect) {
      await prisma.$disconnect();
    }
  } catch {
    // swallow:
    // - prismaClient.js may not exist in certain mock-heavy tests
    // - or it may never have been imported at all
  }
});
