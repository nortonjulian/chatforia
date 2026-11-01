import { jest } from '@jest/globals';
import { bootstrapInitialAdmin } from '../initialAdminBootstrap.js';

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

function makeDb() {
  const db = {
    user: {
      findMany: jest.fn().mockResolvedValue([account()]),
      findUnique: jest.fn().mockResolvedValue(account()),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    auditLog: {
      create: jest.fn().mockResolvedValue({ id: 1 }),
    },
  };

  db.$transaction = jest.fn(async (fn) => fn(db));

  return db;
}

describe('initial administrator bootstrap transaction', () => {
  test('dry-run validates without modifying database', async () => {
    const db = makeDb();

    const result = await bootstrapInitialAdmin(db);

    expect(result).toEqual({
      mode: 'dry-run',
      accountId: 42,
      email: 'julian@chatforia.com',
      currentRole: 'USER',
      eligible: true,
    });

    expect(db.$transaction).not.toHaveBeenCalled();
    expect(db.user.updateMany).not.toHaveBeenCalled();
    expect(db.auditLog.create).not.toHaveBeenCalled();
  });

  test('successful execution updates role and writes audit', async () => {
    const db = makeDb();

    const result = await bootstrapInitialAdmin(db, {
      execute: true,
    });

    expect(result.mode).toBe('executed');
    expect(result.role).toBe('ADMIN');
    expect(result.sessionsRevoked).toBe(true);

    expect(db.$transaction).toHaveBeenCalledTimes(1);

    expect(db.user.updateMany).toHaveBeenCalledWith({
      where: expect.objectContaining({
        id: 42,
        email: 'julian@chatforia.com',
        role: 'USER',
        twoFactorEnabled: true,
        tokenVersion: 3,
      }),
      data: {
        role: 'ADMIN',
        tokenVersion: { increment: 1 },
      },
    });

    expect(db.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        actorId: 42,
        action: 'INITIAL_ADMIN_BOOTSTRAP',
        resourceId: '42',
        metadata: expect.objectContaining({
          source: 'infrastructure_bootstrap',
          selfService: false,
          sessionsRevoked: true,
        }),
      }),
    });
  });

  test('rejects missing company account', async () => {
    const db = makeDb();
    db.user.findMany.mockResolvedValue([]);

    await expect(bootstrapInitialAdmin(db, {
      execute: true,
    })).rejects.toThrow('Expected exactly one company administrator account');

    expect(db.$transaction).not.toHaveBeenCalled();
  });

  test('rejects ambiguous company account', async () => {
    const db = makeDb();
    db.user.findMany.mockResolvedValue([account(), account()]);

    await expect(bootstrapInitialAdmin(db, {
      execute: true,
    })).rejects.toThrow('Expected exactly one company administrator account');

    expect(db.$transaction).not.toHaveBeenCalled();
  });

  test('rejects an already promoted administrator', async () => {
    const db = makeDb();
    db.user.findMany.mockResolvedValue([
      { ...account(), role: 'ADMIN' },
    ]);

    await expect(bootstrapInitialAdmin(db, {
      execute: true,
    })).rejects.toThrow('Target account must have USER role');

    expect(db.user.updateMany).not.toHaveBeenCalled();
  });

  test('rejects changed prerequisites inside transaction', async () => {
    const db = makeDb();
    db.user.findUnique.mockResolvedValue({
      ...account(),
      twoFactorEnabled: false,
    });

    await expect(bootstrapInitialAdmin(db, {
      execute: true,
    })).rejects.toThrow('Target account MFA enrollment is incomplete');

    expect(db.user.updateMany).not.toHaveBeenCalled();
    expect(db.auditLog.create).not.toHaveBeenCalled();
  });

  test('rejects changed account identity inside transaction', async () => {
    const db = makeDb();

    db.user.findUnique.mockResolvedValue({
      ...account(),
      id: 99,
    });

    await expect(bootstrapInitialAdmin(db, {
      execute: true,
    })).rejects.toThrow('Administrator bootstrap account changed');

    expect(db.user.updateMany).not.toHaveBeenCalled();
    expect(db.auditLog.create).not.toHaveBeenCalled();
  });

  test('rejects changed session version inside transaction', async () => {
    const db = makeDb();

    db.user.findUnique.mockResolvedValue({
      ...account(),
      tokenVersion: 4,
    });

    await expect(bootstrapInitialAdmin(db, {
      execute: true,
    })).rejects.toThrow('Administrator bootstrap account changed');

    expect(db.user.updateMany).not.toHaveBeenCalled();
    expect(db.auditLog.create).not.toHaveBeenCalled();
  });

  test('rejects conditional update when state changed', async () => {
    const db = makeDb();
    db.user.updateMany.mockResolvedValue({ count: 0 });

    await expect(bootstrapInitialAdmin(db, {
      execute: true,
    })).rejects.toThrow('Administrator bootstrap preconditions changed');

    expect(db.auditLog.create).not.toHaveBeenCalled();
  });

  test('propagates audit failure instead of claiming success', async () => {
    const db = makeDb();
    db.auditLog.create.mockRejectedValue(
      new Error('Audit insertion failed')
    );

    await expect(bootstrapInitialAdmin(db, {
      execute: true,
    })).rejects.toThrow('Audit insertion failed');

    expect(db.user.updateMany).toHaveBeenCalledTimes(1);
    expect(db.auditLog.create).toHaveBeenCalledTimes(1);
  });
});
