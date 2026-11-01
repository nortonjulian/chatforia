import { jest } from '@jest/globals';
import { executeInitialAdminPromotion } from '../initialAdminExecutionCoordinator.js';

const DATABASE_URL =
  'postgresql://test:test@chatforia-db-do-user-31025199-0.f.db.ondigitalocean.com:25060/defaultdb?sslmode=require';

const CONFIRMATION = 'PROMOTE julian@chatforia.com ON defaultdb';

const account = () => ({
  id: 42,
  email: 'julian@chatforia.com',
  role: 'USER',
  isBanned: false,
  deletedAt: null,
  emailVerifiedAt: new Date(),
  twoFactorEnabled: true,
  totpSecretEnc: 'encrypted-test-secret',
  twoFactorEnrolledAt: new Date(),
  tokenVersion: 3,
});

function makePrisma() {
  let current = account();
  let auditRecord = null;

  const db = {
    $queryRaw: jest.fn().mockResolvedValue([{
      database_name: 'defaultdb',
      schema_name: 'public',
    }]),
    user: {
      findMany: jest.fn(async () => [{ ...current }]),
      findUnique: jest.fn(async () => ({ ...current })),
      updateMany: jest.fn(async () => {
        current = {
          ...current,
          role: 'ADMIN',
          tokenVersion: current.tokenVersion + 1,
        };
        return { count: 1 };
      }),
    },
    auditLog: {
      create: jest.fn(async ({ data }) => {
        auditRecord = { id: 1, ...data };
        return auditRecord;
      }),
      findFirst: jest.fn(async () => auditRecord),
    },
  };

  db.$transaction = jest.fn(async (callback) => callback(db));

  return db;
}

describe('initial administrator execution coordinator', () => {
  test('rejects non-production before querying database', async () => {
    const prisma = makePrisma();
    const requestConfirmation = jest.fn();

    await expect(executeInitialAdminPromotion({
      prisma,
      databaseUrl: DATABASE_URL,
      nodeEnv: 'test',
      requestConfirmation,
    })).rejects.toThrow('Production environment required');

    expect(prisma.$queryRaw).not.toHaveBeenCalled();
    expect(requestConfirmation).not.toHaveBeenCalled();
    expect(prisma.user.updateMany).not.toHaveBeenCalled();
  });

  test('rejects unexpected connected database before confirmation', async () => {
    const prisma = makePrisma();
    const requestConfirmation = jest.fn();

    prisma.$queryRaw.mockResolvedValue([{
      database_name: 'another_database',
      schema_name: 'public',
    }]);

    await expect(executeInitialAdminPromotion({
      prisma,
      databaseUrl: DATABASE_URL,
      nodeEnv: 'production',
      requestConfirmation,
    })).rejects.toThrow('Administrator bootstrap database identity mismatch');

    expect(requestConfirmation).not.toHaveBeenCalled();
    expect(prisma.user.updateMany).not.toHaveBeenCalled();
  });

  test('rejects incorrect endpoint fingerprint', async () => {
    const prisma = makePrisma();
    const requestConfirmation = jest.fn();

    await expect(executeInitialAdminPromotion({
      prisma,
      databaseUrl:
        'postgresql://test:test@unexpected.example.com:25060/defaultdb',
      nodeEnv: 'production',
      requestConfirmation,
    })).rejects.toThrow('Administrator bootstrap endpoint mismatch');

    expect(requestConfirmation).not.toHaveBeenCalled();
    expect(prisma.user.updateMany).not.toHaveBeenCalled();
  });

  test('rejects incorrect operator confirmation', async () => {
    const prisma = makePrisma();

    await expect(executeInitialAdminPromotion({
      prisma,
      databaseUrl: DATABASE_URL,
      nodeEnv: 'production',
      requestConfirmation: async () => 'yes',
    })).rejects.toThrow('Administrator execution confirmation mismatch');

    expect(prisma.user.updateMany).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  test('executes validated promotion and audit atomically', async () => {
    const prisma = makePrisma();
    const requestConfirmation = jest.fn()
      .mockResolvedValue(CONFIRMATION);

    const result = await executeInitialAdminPromotion({
      prisma,
      databaseUrl: DATABASE_URL,
      nodeEnv: 'production',
      requestConfirmation,
    });

    expect(result.mode).toBe('executed');
    expect(result.role).toBe('ADMIN');
    expect(result.sessionsRevoked).toBe(true);

    expect(requestConfirmation).toHaveBeenCalledTimes(1);
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(prisma.user.updateMany).toHaveBeenCalledTimes(1);
    expect(prisma.auditLog.create).toHaveBeenCalledTimes(1);
  });

  test('rejects missing post-promotion audit record', async () => {
    const prisma = makePrisma();
    prisma.auditLog.findFirst.mockResolvedValue(null);

    await expect(executeInitialAdminPromotion({
      prisma,
      databaseUrl: DATABASE_URL,
      nodeEnv: 'production',
      requestConfirmation: async () => CONFIRMATION,
    })).rejects.toThrow('Administrator post-promotion verification failed');

    expect(prisma.user.updateMany).toHaveBeenCalledTimes(1);
    expect(prisma.auditLog.create).toHaveBeenCalledTimes(1);
  });

  test('rejects incorrect final session version', async () => {
    const prisma = makePrisma();

    const original = prisma.user.findUnique;
    let calls = 0;

    prisma.user.findUnique = jest.fn(async (...args) => {
      calls++;
      const value = await original(...args);

      if (calls === 3) {
        return {
          ...value,
          tokenVersion: 99,
        };
      }

      return value;
    });

    await expect(executeInitialAdminPromotion({
      prisma,
      databaseUrl: DATABASE_URL,
      nodeEnv: 'production',
      requestConfirmation: async () => CONFIRMATION,
    })).rejects.toThrow('Administrator post-promotion verification failed');
  });

  test('rejects incorrect final administrator role', async () => {
    const prisma = makePrisma();

    const original = prisma.user.findUnique;
    let calls = 0;

    prisma.user.findUnique = jest.fn(async (...args) => {
      calls++;
      const value = await original(...args);

      if (calls === 3) {
        return {
          ...value,
          role: 'USER',
        };
      }

      return value;
    });

    await expect(executeInitialAdminPromotion({
      prisma,
      databaseUrl: DATABASE_URL,
      nodeEnv: 'production',
      requestConfirmation: async () => CONFIRMATION,
    })).rejects.toThrow('Administrator post-promotion verification failed');
  });

  test('rejects changed account state inside transaction', async () => {
    const prisma = makePrisma();
    prisma.user.findUnique.mockImplementation(async () => ({
      ...account(),
      twoFactorEnabled: false,
    }));

    await expect(executeInitialAdminPromotion({
      prisma,
      databaseUrl: DATABASE_URL,
      nodeEnv: 'production',
      requestConfirmation: async () => CONFIRMATION,
    })).rejects.toThrow('Target account MFA enrollment is incomplete');

    expect(prisma.user.updateMany).not.toHaveBeenCalled();
    expect(prisma.auditLog.create).not.toHaveBeenCalled();
  });
});
