/**
 * Exact-function integration test against a dedicated localhost test DB.
 * Creates and removes a disposable account.
 */
import { jest, test, expect } from '@jest/globals';
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { assertTestDatabaseSelected } from './helpers/testDatabase.js';
import { bootstrapInitialAdmin } from '../scripts/initialAdminBootstrap.js';

jest.setTimeout(60000);

const { raw } = assertTestDatabaseSelected();
const target = new URL(raw);
const database = decodeURIComponent(target.pathname.slice(1));

if (
  !['localhost', '127.0.0.1', '[::1]'].includes(target.hostname) ||
  !/(^|_)test($|_)/i.test(database) ||
  (target.searchParams.get('schema') || 'public') !== 'public'
) {
  throw new Error('STOP: Unsafe database target');
}

const prisma = new PrismaClient({
  datasources: { db: { url: raw } },
});

test('exact bootstrap promotes MFA-enrolled account and writes audit', async () => {
  let userId;

  try {
    const existing = await prisma.user.count({
      where: {
        email: {
          equals: 'julian@chatforia.com',
          mode: 'insensitive',
        },
      },
    });

    if (existing !== 0) {
      throw new Error('STOP: Test identity already exists');
    }

    const suffix = randomUUID().replaceAll('-', '');

    const user = await prisma.user.create({
      data: {
        username: `bootstrap_exact_${suffix}`,
        email: 'julian@chatforia.com',
        passwordHash: 'test-only-not-login',
        role: 'USER',
        tokenVersion: 3,
        emailVerifiedAt: new Date(),
        twoFactorEnabled: true,
        twoFactorEnrolledAt: new Date(),
        totpSecretEnc: 'encrypted-test-secret',
      },
    });

    userId = user.id;

    const dryRun = await bootstrapInitialAdmin(prisma);
    expect(dryRun.mode).toBe('dry-run');
    expect(dryRun.eligible).toBe(true);

    const result = await bootstrapInitialAdmin(prisma, {
      execute: true,
    });

    expect(result.mode).toBe('executed');
    expect(result.role).toBe('ADMIN');

    const updated = await prisma.user.findUnique({
      where: { id: userId },
      select: { role: true, tokenVersion: true },
    });

    expect(updated).toEqual({
      role: 'ADMIN',
      tokenVersion: 4,
    });

    const audit = await prisma.auditLog.findFirst({
      where: {
        action: 'INITIAL_ADMIN_BOOTSTRAP',
        resourceId: String(userId),
      },
    });

    expect(audit).not.toBeNull();
    expect(audit.actorId).toBe(userId);

    await expect(
      bootstrapInitialAdmin(prisma, { execute: true })
    ).rejects.toThrow('Target account must have USER role');
  } finally {
    if (userId) {
      await prisma.user.delete({
        where: { id: userId },
      });
    }

    await prisma.$disconnect();
  }
});
