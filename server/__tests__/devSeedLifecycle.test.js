/** @jest-environment node */
import { jest, test, expect } from '@jest/globals';

const db = {
  $queryRaw: jest.fn(),
  $disconnect: jest.fn().mockResolvedValue(undefined),
};

const seedTranslations = jest.fn().mockResolvedValue(undefined);
const seedDevData = jest.fn().mockResolvedValue(undefined);

await jest.unstable_mockModule('../utils/prismaClient.js', () => ({
  __esModule: true,
  default: db,
}));

await jest.unstable_mockModule('../prisma/seedTranslations.js', () => ({
  seedTranslations,
}));

await jest.unstable_mockModule('../prisma/seedDevData.js', () => ({
  seedDevData,
}));

const originalEnv = {
  NODE_ENV: process.env.NODE_ENV,
  ALLOW_DEV_DATA_SEED: process.env.ALLOW_DEV_DATA_SEED,
  DATABASE_URL: process.env.DATABASE_URL,
  DEV_SEED_DATABASE_URL: process.env.DEV_SEED_DATABASE_URL,
  DEV_SEED_PASSWORD: process.env.DEV_SEED_PASSWORD,
};

const safeUrl =
  'postgresql://dev:dev@127.0.0.1:5432/chatforia_dev?schema=public';

function restoreEnvironment() {
  for (const [key, value] of Object.entries(originalEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

function configureSafeEnvironment() {
  process.env.NODE_ENV = 'development';
  process.env.ALLOW_DEV_DATA_SEED = 'true';
  process.env.DATABASE_URL = safeUrl;
  process.env.DEV_SEED_DATABASE_URL = safeUrl;
  process.env.DEV_SEED_PASSWORD = 'example-development-password-123';
}

const { runMasterSeed } = await import('../prisma/seed.js');

test('master seed disconnects after successful execution', async () => {
  configureSafeEnvironment();

  db.$queryRaw.mockResolvedValue([{
    database: 'chatforia_dev',
    schema: 'public',
  }]);

  try {
    await runMasterSeed();

    expect(seedTranslations).toHaveBeenCalledTimes(1);
    expect(seedDevData).toHaveBeenCalledTimes(1);
    expect(db.$disconnect).toHaveBeenCalledTimes(1);
  } finally {
    restoreEnvironment();
  }
});

test('master seed disconnects when database verification fails', async () => {
  configureSafeEnvironment();

  db.$queryRaw.mockResolvedValue([{
    database: 'defaultdb',
    schema: 'public',
  }]);

  try {
    await expect(runMasterSeed()).rejects.toThrow(
      /identity does not match/
    );

    expect(seedTranslations).not.toHaveBeenCalled();
    expect(seedDevData).not.toHaveBeenCalled();
    expect(db.$disconnect).toHaveBeenCalledTimes(1);
  } finally {
    restoreEnvironment();
  }
});
