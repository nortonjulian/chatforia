/** @jest-environment node */
import {
  jest, beforeEach, afterEach, describe, test, expect,
} from '@jest/globals';

const db = {
  $queryRaw: jest.fn(),
  user: {
    findMany: jest.fn(),
    upsert: jest.fn(),
  },
};

await jest.unstable_mockModule('../utils/prismaClient.js', () => ({
  __esModule: true,
  default: db,
}));

await jest.unstable_mockModule('bcrypt', () => ({
  __esModule: true,
  default: {
    hash: jest.fn(async () => 'mocked-hash'),
  },
}));

await jest.unstable_mockModule('../utils/encryption.js', () => ({
  generateKeyPair: jest.fn(() => ({
    publicKey: 'mock-public-key',
  })),
}));

const { seedDevData } = await import('../prisma/seedDevData.js');

const originalEnv = {
  NODE_ENV: process.env.NODE_ENV,
  ALLOW_DEV_DATA_SEED: process.env.ALLOW_DEV_DATA_SEED,
  DATABASE_URL: process.env.DATABASE_URL,
  DEV_SEED_DATABASE_URL: process.env.DEV_SEED_DATABASE_URL,
  DEV_SEED_PASSWORD: process.env.DEV_SEED_PASSWORD,
};

const safeUrl =
  'postgresql://dev:dev@127.0.0.1:5432/chatforia_dev?schema=public';

function configureSafeEnvironment() {
  process.env.NODE_ENV = 'development';
  process.env.ALLOW_DEV_DATA_SEED = 'true';
  process.env.DATABASE_URL = safeUrl;
  process.env.DEV_SEED_DATABASE_URL = safeUrl;
  process.env.DEV_SEED_PASSWORD = 'example-development-password-123';
}

beforeEach(() => {
  jest.clearAllMocks();
  configureSafeEnvironment();

  db.$queryRaw.mockResolvedValue([{
    database: 'chatforia_dev',
    schema: 'public',
  }]);

  db.user.findMany.mockResolvedValue([]);

  db.user.upsert.mockImplementation(async ({ create }) => ({
    id: Number(create.username.split('_').at(-1)),
    ...create,
  }));
});

afterEach(() => {
  for (const [name, value] of Object.entries(originalEnv)) {
    if (value === undefined) {
      delete process.env[name];
    } else {
      process.env[name] = value;
    }
  }
});

describe('development seed execution safety', () => {
  test('rejects production before any database query', async () => {
    process.env.NODE_ENV = 'production';

    await expect(seedDevData()).rejects.toThrow();

    expect(db.$queryRaw).not.toHaveBeenCalled();
    expect(db.user.findMany).not.toHaveBeenCalled();
    expect(db.user.upsert).not.toHaveBeenCalled();
  });

  test('rejects missing password before database access', async () => {
    delete process.env.DEV_SEED_PASSWORD;

    await expect(seedDevData()).rejects.toThrow(
      /DEV_SEED_PASSWORD/
    );

    expect(db.$queryRaw).not.toHaveBeenCalled();
    expect(db.user.upsert).not.toHaveBeenCalled();
  });

  test('rejects mismatched connected database before writes', async () => {
    db.$queryRaw.mockResolvedValueOnce([{
      database: 'defaultdb',
      schema: 'public',
    }]);

    await expect(seedDevData()).rejects.toThrow(
      /identity does not match/
    );

    expect(db.user.findMany).not.toHaveBeenCalled();
    expect(db.user.upsert).not.toHaveBeenCalled();
  });

  test('rejects email identity collision before writes', async () => {
    db.user.findMany.mockResolvedValueOnce([{
      username: 'unexpected_user',
      email: 'dev_user_2@example.com',
    }]);

    await expect(seedDevData()).rejects.toThrow(
      /identity collision/
    );

    expect(db.user.upsert).not.toHaveBeenCalled();
  });

  test('rejects username identity collision before writes', async () => {
    db.user.findMany.mockResolvedValueOnce([{
      username: 'dev_user_3',
      email: 'unexpected@example.com',
    }]);

    await expect(seedDevData()).rejects.toThrow(
      /identity collision/
    );

    expect(db.user.upsert).not.toHaveBeenCalled();
  });

  test('creates only reserved fixtures with no account updates', async () => {
    await seedDevData();

    expect(db.user.upsert).toHaveBeenCalledTimes(4);

    const calls = db.user.upsert.mock.calls.map(([args]) => args);

    expect(calls.map((args) => args.create.username)).toEqual([
      'dev_user_1',
      'dev_user_2',
      'dev_user_3',
      'dev_user_4',
    ]);

    for (const args of calls) {
      expect(args.update).toEqual({});
      expect(args.create.passwordHash).toBe('mocked-hash');
      expect(args.create).not.toHaveProperty('phoneNumber');
    }
  });

  test('preserves matching existing fixture identities', async () => {
    db.user.findMany.mockResolvedValueOnce([{
      username: 'dev_user_1',
      email: 'dev_user_1@example.com',
    }]);

    await seedDevData();

    expect(db.user.upsert).toHaveBeenCalledTimes(4);

    for (const [args] of db.user.upsert.mock.calls) {
      expect(args.update).toEqual({});
    }
  });
});
