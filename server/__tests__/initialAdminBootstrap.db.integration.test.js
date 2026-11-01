/**
 * Real PostgreSQL transaction rollback verification.
 * Requires a dedicated localhost *_test database.
 * Never targets the production administrator account.
 */
import { jest, test, expect } from '@jest/globals';
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { assertTestDatabaseSelected } from './helpers/testDatabase.js';

jest.setTimeout(60000);

const { raw } = assertTestDatabaseSelected();
const target = new URL(raw);
const dbName = decodeURIComponent(target.pathname.slice(1));

if (
  !['localhost', '127.0.0.1', '[::1]'].includes(target.hostname) ||
  !/(^|_)test($|_)/i.test(dbName) ||
  (target.searchParams.get('schema') || 'public') !== 'public'
) {
  throw new Error('STOP: Unsafe integration database target');
}

const prisma = new PrismaClient({
  datasources: { db: { url: raw } },
});

test('audit failure rolls back role and tokenVersion', async () => {
  const suffix = randomUUID().replaceAll('-', '');
  const username = `bootstrap_rollback_${suffix}`;

  let userId;

  try {
    const user = await prisma.user.create({
      data: {
        username,
        passwordHash: 'test-only-not-login',
        role: 'USER',
        tokenVersion: 3,
      },
    });

    userId = user.id;

    await expect(
      prisma.$transaction(async (tx) => {
        await tx.user.update({
          where: { id: userId },
          data: {
            role: 'ADMIN',
            tokenVersion: { increment: 1 },
          },
        });

        // Deliberately violate the audit actor foreign key.
        // The audit insertion must fail, aborting the transaction.
        await tx.auditLog.create({
          data: {
            actorId: 2147483647,
            action: 'INITIAL_ADMIN_BOOTSTRAP_TEST_FAILURE',
            resource: 'user',
            resourceId: String(userId),
            status: 200,
          },
        });
      })
    ).rejects.toThrow();

    const after = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        role: true,
        tokenVersion: true,
      },
    });

    expect(after).toEqual({
      role: 'USER',
      tokenVersion: 3,
    });

    const audit = await prisma.auditLog.findFirst({
      where: {
        action: 'INITIAL_ADMIN_BOOTSTRAP_TEST_FAILURE',
        resourceId: String(userId),
      },
    });

    expect(audit).toBeNull();
  } finally {
    if (userId) {
      await prisma.user.delete({
        where: { id: userId },
      });
    }

    await prisma.$disconnect();
  }
});
