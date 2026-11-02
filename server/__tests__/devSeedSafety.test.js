/** @jest-environment node */
import { describe, test, expect, jest } from '@jest/globals';
import {
  assertDevSeedTarget,
  assertConnectedDevSeedTarget,
  getDevSeedPassword,
} from '../prisma/assertDevSeedTarget.js';

const safeUrl =
  'postgresql://dev:dev@127.0.0.1:5432/chatforia_dev?schema=public';

const safeEnv = {
  NODE_ENV: 'development',
  ALLOW_DEV_DATA_SEED: 'true',
  DATABASE_URL: safeUrl,
  DEV_SEED_DATABASE_URL: safeUrl,
  DEV_SEED_PASSWORD: 'example-development-password-123',
};

describe('development seed safety', () => {
  test('accepts an explicitly authorized local development target', () => {
    expect(assertDevSeedTarget(safeEnv)).toEqual({
      database: 'chatforia_dev',
      schema: 'public',
    });
  });

  test.each([
    [{ NODE_ENV: 'production' }, 'production environment'],
    [{ ALLOW_DEV_DATA_SEED: 'false' }, 'missing authorization'],
    [{ DATABASE_URL: undefined }, 'missing database URL'],
    [{ DEV_SEED_DATABASE_URL: undefined }, 'missing approved URL'],
    [{ DEV_SEED_DATABASE_URL: 'postgresql://other' }, 'URL mismatch'],
    [{
      DATABASE_URL: 'postgresql://dev:dev@remote.example.com/chatforia_dev',
      DEV_SEED_DATABASE_URL: 'postgresql://dev:dev@remote.example.com/chatforia_dev',
    }, 'remote database'],
    [{
      DATABASE_URL: 'postgresql://dev:dev@127.0.0.1/defaultdb',
      DEV_SEED_DATABASE_URL: 'postgresql://dev:dev@127.0.0.1/defaultdb',
    }, 'production database name'],
  ])('rejects %s (%s)', (overrides) => {
    expect(() =>
      assertDevSeedTarget({ ...safeEnv, ...overrides })
    ).toThrow();
  });

  test('rejects missing or weak development passwords', () => {
    expect(() =>
      getDevSeedPassword({
        ...safeEnv,
        DEV_SEED_PASSWORD: 'short',
      })
    ).toThrow();

    expect(() =>
      getDevSeedPassword({
        ...safeEnv,
        DEV_SEED_PASSWORD: undefined,
      })
    ).toThrow();
  });

  test('accepts an explicitly configured development password', () => {
    expect(getDevSeedPassword(safeEnv)).toBe(
      safeEnv.DEV_SEED_PASSWORD
    );
  });

  test('verifies the actual connected database identity', async () => {
    const prisma = {
      $queryRaw: jest.fn().mockResolvedValue([{
        database: 'chatforia_dev',
        schema: 'public',
      }]),
    };

    await expect(
      assertConnectedDevSeedTarget(prisma, safeEnv)
    ).resolves.toEqual({
      database: 'chatforia_dev',
      schema: 'public',
    });

    expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
  });

  test('rejects a mismatched connected database', async () => {
    const prisma = {
      $queryRaw: jest.fn().mockResolvedValue([{
        database: 'defaultdb',
        schema: 'public',
      }]),
    };

    await expect(
      assertConnectedDevSeedTarget(prisma, safeEnv)
    ).rejects.toThrow(/identity does not match/);
  });

  test('rejects a mismatched connected schema', async () => {
    const prisma = {
      $queryRaw: jest.fn().mockResolvedValue([{
        database: 'chatforia_dev',
        schema: 'unexpected',
      }]),
    };

    await expect(
      assertConnectedDevSeedTarget(prisma, safeEnv)
    ).rejects.toThrow(/identity does not match/);
  });

  test('rejects production before querying the database', async () => {
    const prisma = {
      $queryRaw: jest.fn(),
    };

    await expect(
      assertConnectedDevSeedTarget(prisma, {
        ...safeEnv,
        NODE_ENV: 'production',
      })
    ).rejects.toThrow();

    expect(prisma.$queryRaw).not.toHaveBeenCalled();
  });
});
