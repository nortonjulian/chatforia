import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { PrismaClient, Prisma } from '@prisma/client';

import {
  grantOrChangeStaffAccess,
} from '../security/staffGrantService.js';

import {
  revokeStaffAccess,
} from '../security/staffRevocationService.js';

const expectedDatabase = 'chatforia_staff_access_test_20261102';
const expectedBranch = 'feature/staff-access-rbac-20261102';
const url = process.env.DATABASE_URL;

if (!url || url !== process.env.TEST_DATABASE_URL) {
  throw new Error('STOP: DATABASE_URL and TEST_DATABASE_URL must match');
}

const parsed = new URL(url);
const branch = execFileSync('git', ['branch', '--show-current'], {
  encoding: 'utf8',
}).trim();

if (
  branch !== expectedBranch ||
  parsed.hostname !== '127.0.0.1' ||
  parsed.hash ||
  [...parsed.searchParams].length > 1 ||
  [...parsed.searchParams].some(([key, value]) => key !== 'schema' || value !== 'public') ||
  parsed.pathname !== `/${expectedDatabase}` ||
  (parsed.searchParams.get('schema') || 'public') !== 'public' ||
  (parsed.port && parsed.port !== '5432')
) {
  throw new Error('STOP: Unsafe integration environment');
}

const prisma = new PrismaClient({
  datasources: { db: { url } },
});

const secret = randomBytes(32).toString('hex');
const previousSecret = process.env.STAFF_ACCESS_SIGNING_SECRET;

process.env.STAFF_ACCESS_SIGNING_SECRET = secret;

class ExpectedRollback extends Error {}

function requireFixture(user, assignment, version, profile) {
  assert.equal(user?.tokenVersion, version);
  assert.equal(assignment?.profile, profile);
  assert.equal(assignment?.active, true);
}

async function state(db) {
  const [u16, u18, s16, s18, history, audits, registry] =
    await Promise.all([
      db.user.findUnique({ where: { id: 16 } }),
      db.user.findUnique({ where: { id: 18 } }),
      db.staffAssignment.findUnique({ where: { userId: 16 } }),
      db.staffAssignment.findUnique({ where: { userId: 18 } }),
      db.staffAccessEvent.count(),
      db.auditLog.count(),
      db.$queryRaw`
        SELECT count(*)::integer AS total
        FROM staff_security.consumed_assertions
      `,
    ]);

  return {
    u16, u18, s16, s18,
    history, audits,
    consumed: registry[0].total,
  };
}

async function main() {
  const identity = await prisma.$queryRaw`
    SELECT current_user AS role, current_database() AS database
  `;

  assert.equal(identity[0].database, expectedDatabase);
  // This harness needs administrative authority to install
  // and restore its temporary verification key transactionally.
  assert.equal(identity[0].role, 'juliannorton');

  const baseline = await state(prisma);

  console.log('PASS: Integration baseline captured');

  let reachedRollback = false;

  try {
    await prisma.$transaction(async (tx) => {
      // All integration fixtures are confined to this rollback-only
      // transaction. Never alter existing user or staff records.
      const occupied = await tx.user.count({
        where: { id: { in: [13, 16, 17, 18] } },
      });
      const existingFounder = await tx.founderOwnership.count();
      const existingAssignments = await tx.staffAssignment.count();

      if (occupied || existingFounder || existingAssignments) {
        throw new Error(
          'STOP: Integration fixture IDs or privileged records already exist'
        );
      }

      await tx.user.createMany({
        data: [
          {
            id: 13,
            username: 'staff_integration_founder_13',
            passwordHash: 'qa-unusable-password',
          },
          {
            id: 16,
            username: 'staff_integration_target_16',
            passwordHash: 'qa-unusable-password',
            emailVerifiedAt: new Date(),
            twoFactorEnabled: true,
            twoFactorEnrolledAt: new Date(),
            totpSecretEnc: 'qa-placeholder',
            tokenVersion: 5,
          },
          {
            id: 17,
            username: 'staff_integration_actor_17',
            passwordHash: 'qa-unusable-password',
            emailVerifiedAt: new Date(),
            twoFactorEnabled: true,
            twoFactorEnrolledAt: new Date(),
            totpSecretEnc: 'qa-placeholder',
            tokenVersion: 0,
          },
          {
            id: 18,
            username: 'staff_integration_target_18',
            passwordHash: 'qa-unusable-password',
            emailVerifiedAt: new Date(),
            twoFactorEnabled: true,
            twoFactorEnrolledAt: new Date(),
            totpSecretEnc: 'qa-placeholder',
            tokenVersion: 2,
          },
        ],
      });

      await tx.founderOwnership.create({
        data: {
          id: 1,
          userId: 13,
          verificationRef: 'rollback-only-prisma-integration',
        },
      });

      await tx.staffAssignment.createMany({
        data: [
          {
            userId: 17,
            profile: 'ACCESS_ADMIN',
            active: true,
            grantedById: 13,
          },
          {
            userId: 16,
            profile: 'SUPPORT',
            active: true,
            grantedById: 17,
          },
          {
            userId: 18,
            profile: 'SUPPORT',
            active: true,
            grantedById: 17,
          },
        ],
      });

      console.log('PASS: Transaction-local staff fixtures initialized');

      const updated = await tx.$executeRaw`
        UPDATE staff_security.assertion_secrets
        SET verification_secret =
          convert_to(${secret}, 'UTF8')
        WHERE id = 1 AND key_version = 3
      `;

      assert.equal(updated, 1);

      await tx.$executeRawUnsafe(
        'SET LOCAL ROLE chatforia_dev'
      );

      // Existing services expect a transaction-capable db.
      // Reuse this actual Serializable transaction for both,
      // without opening another transaction.
      const transactionalDb = {
        $transaction: async (callback, options) => {
          assert.equal(options.isolationLevel, 'Serializable');
          return callback(tx);
        },
      };

      const authentication = {
        mfaVerified: true,
        tokenVersion: 0,
      };

      const grantResult = await grantOrChangeStaffAccess({
        actorUserId: 17,
        targetUserId: 16,
        targetProfile: 'SENIOR_ENGINEER',
        authentication,
        reason: 'Step 607C authorized profile change',
        db: transactionalDb,
      });

      assert.deepEqual(grantResult, {
        action: 'STAFF_PROFILE_CHANGED',
        targetUserId: 16,
        profile: 'SENIOR_ENGINEER',
        sessionsRevoked: true,
      });

      console.log('PASS: Real Prisma protected profile change');

      const revokeResult = await revokeStaffAccess({
        actorUserId: 17,
        targetUserId: 18,
        authentication,
        reason: 'Step 607C authorized staff revocation',
        db: transactionalDb,
      });

      assert.deepEqual(revokeResult, {
        action: 'STAFF_ACCESS_REVOKED',
        targetUserId: 18,
        previousProfile: 'SUPPORT',
        sessionsRevoked: true,
      });

      console.log('PASS: Real Prisma protected revocation');

      // Restore administrative role for independent inspection.
      await tx.$executeRawUnsafe('RESET ROLE');

      const changed = await state(tx);

      assert.equal(changed.u16.tokenVersion, 6);
      assert.equal(changed.s16.profile, 'SENIOR_ENGINEER');
      assert.equal(changed.s16.active, true);

      assert.equal(changed.u18.tokenVersion, 3);
      assert.equal(changed.s18.active, false);
      assert.equal(changed.s18.revokedById, 17);
      assert.ok(changed.s18.revokedAt);

      assert.equal(changed.history, baseline.history + 2);
      assert.equal(changed.audits, baseline.audits + 2);
      assert.equal(changed.consumed, baseline.consumed + 2);

      console.log('PASS: Session invalidation and both audit trails');
      console.log('PASS: Both authorization assertions consumed');

      reachedRollback = true;
      throw new ExpectedRollback('QA transaction rollback');
    }, {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      timeout: 30000,
    });
  } catch (error) {
    if (!(error instanceof ExpectedRollback) || !reachedRollback) {
      throw error;
    }
  }

  const restored = await state(prisma);

  assert.deepEqual(restored.u16, baseline.u16);
  assert.deepEqual(restored.u18, baseline.u18);
  assert.deepEqual(restored.s16, baseline.s16);
  assert.deepEqual(restored.s18, baseline.s18);

  assert.equal(
    await prisma.user.count({
      where: { id: { in: [13, 16, 17, 18] } },
    }),
    0
  );
  assert.equal(await prisma.founderOwnership.count(), 0);
  assert.equal(await prisma.staffAssignment.count(), 0);

  assert.equal(restored.history, baseline.history);
  assert.equal(restored.audits, baseline.audits);
  assert.equal(restored.consumed, baseline.consumed);

  console.log('PASS: All employee and audit changes rolled back');
  console.log('PASS: Step 607C actual Prisma integration');
}

try {
  await main();
} catch (error) {
  console.error('STOP: Step 607C failed:', error.message);
  process.exitCode = 1;
} finally {
  if (previousSecret === undefined) {
    delete process.env.STAFF_ACCESS_SIGNING_SECRET;
  } else {
    process.env.STAFF_ACCESS_SIGNING_SECRET = previousSecret;
  }

  await prisma.$disconnect();
}
