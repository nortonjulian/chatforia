// server/__tests__/jest.setup.js
import { beforeEach, afterAll, jest } from '@jest/globals';

// ✅ Global mocks for server-side utils ONLY
// Paths are relative to THIS file: server/__tests__/jest.setup.js
jest.mock('../utils/logger.js', () => ({
  __esModule: true,
  default: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

jest.mock('../utils/mailer.js', () => ({
  __esModule: true,
  sendMail: jest.fn(),
}));

beforeEach(() => {
  jest.clearAllMocks();
});

afterAll(async () => {
  jest.resetModules();

  try {
    const prismaModule = await import('../utils/prismaClient.js');
    const prisma =
      prismaModule.prisma || prismaModule.default || prismaModule;

    if (prisma?.$disconnect) {
      await prisma.$disconnect();
    }
  } catch {
    // fine if prisma not used
  }
});
