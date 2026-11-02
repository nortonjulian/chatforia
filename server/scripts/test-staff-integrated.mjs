import assert from 'node:assert/strict';
import { randomBytes, createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { PrismaClient } from '@prisma/client';
import speakeasy from 'speakeasy';
import { sqlStatements } from './staff-qa-sql.mjs';

const url = new URL(process.env.DATABASE_URL || 'invalid:');
assert.equal(url.protocol, 'postgresql:');
assert.equal(url.hostname, '127.0.0.1');
assert.equal(url.port || '5432', '5432');
assert.equal(url.pathname, '/chatforia_staff_access_test_20261102');
assert.equal(url.searchParams.get('schema') || 'public', 'public');
assert.equal(
  execFileSync('git', ['branch', '--show-current'], {
    encoding: 'utf8',
  }).trim(),
  'feature/staff-access-rbac-20261102'
);
process.env.APP_ENC_KEY = randomBytes(32).toString('base64');
process.env.STAFF_ACCESS_SIGNING_SECRET = randomBytes(32).toString('hex');
process.env.STAFF_SECURITY_ENABLED = 'true';
process.env.JWT_SECRET = randomBytes(32).toString('hex');
const { seal } = await import('../utils/secretBox.js');
const { createMfaChallenge, completeMfaChallenge } = await import(
  '../services/mfaLogin.js'
);
const { assertStaffRuntimeReady } = await import(
  '../security/staffRuntimeReadiness.js'
);
const { grantOrChangeStaffAccess } = await import(
  '../security/staffGrantService.js'
);
const { revokeStaffAccess } = await import(
  '../security/staffRevocationService.js'
);
const { createStaffAuthorizationAssertion } = await import(
  '../security/staffAuthorizationAssertion.js'
);
const db = new PrismaClient({ datasources: { db: { url: url.href } } });
class Rollback extends Error {}
let checks = 0;
const pass = (message) => {
  checks++;
  console.log('PASS:', message);
};
const hash = (value) => createHash('sha256').update(value).digest('hex');
const pending = [
  '20261102090000_protect_staff_user_identity',
  '20261102091000_runtime_role_permissions',
  '20261102092000_protected_credential_recovery',
  '20261102093000_protected_mfa_login',
];
try {
  const identity =
    await db.$queryRaw`SELECT current_database() AS db, current_user AS role`;
  assert.equal(identity[0].role, 'juliannorton');
  assert.equal(identity[0].db, url.pathname.slice(1));
  const before = await db.user.count();
  let rolled = false;
  try {
    await db.$transaction(
      async (tx) => {
        for (const role of [
          'chatforia_recovery_issuer',
          'chatforia_recovery_executor',
          'qa_staff_issuer',
          'qa_staff_executor',
        ]) {
          // Test-only roles and memberships are rolled back with all DDL.
          await tx.$executeRawUnsafe(`CREATE ROLE ${role} NOLOGIN`);
        }
        await tx.$executeRawUnsafe(
          'GRANT chatforia_recovery_issuer TO qa_staff_issuer'
        );
        await tx.$executeRawUnsafe(
          'GRANT chatforia_recovery_executor TO qa_staff_executor'
        );
        for (const name of pending) {
          for (const statement of sqlStatements(
            readFileSync(
              `server/prisma/migrations/${name}/migration.sql`,
              'utf8'
            )
          )) {
            await tx.$executeRawUnsafe(statement);
          }
        }
        pass(
          'All pending migrations install together inside rollback-only Prisma transaction'
        );
        const fixtures = readFileSync(
          'server/security/db-qa/staff-qa-fixtures.sql',
          'utf8'
        );
        for (const sql of sqlStatements(fixtures))
          await tx.$executeRawUnsafe(sql);
        const totp = speakeasy.generateSecret().base32;
        await tx.$executeRawUnsafe('SET LOCAL ROLE chatforia_staff_owner');
        await tx.user.update({
          where: { id: 17 },
          data: { totpSecretEnc: seal(totp) },
        });
        await tx.$executeRawUnsafe('RESET ROLE');
        await tx.$executeRaw`UPDATE staff_security.assertion_secrets SET verification_secret = convert_to(${process.env.STAFF_ACCESS_SIGNING_SECRET}, 'UTF8') WHERE id = 1`;
        await tx.$executeRawUnsafe('SET LOCAL ROLE chatforia_dev');
        await assertStaffRuntimeReady(tx);
        pass(
          'Deployment runtime readiness accepts the migrated least-privilege role'
        );
        const transactional = { $transaction: (callback) => callback(tx) };
        // Keep the transaction usable after every expected PostgreSQL error.
        async function denied(callback, label) {
          await tx.$executeRawUnsafe('SAVEPOINT expected_denial');
          await assert.rejects(callback);
          await tx.$executeRawUnsafe('ROLLBACK TO SAVEPOINT expected_denial');
          pass(label);
        }
        const ordinary = await tx.user.create({
          data: {
            id: 9000020,
            username: 'qa_ordinary_runtime',
            passwordHash: 'unusable',
            emailVerifiedAt: new Date(),
            twoFactorEnabled: true,
            twoFactorEnrolledAt: new Date(),
            totpSecretEnc: seal(totp),
          },
        });
        const ordinaryChallenge = await createMfaChallenge(
          ordinary,
          null,
          transactional
        );
        assert.equal(
          (
            await completeMfaChallenge(
              ordinaryChallenge,
              speakeasy.totp({ secret: totp, encoding: 'base32' }),
              transactional
            )
          ).ok,
          true
        );
        await tx.passwordResetToken.create({
          data: {
            userId: ordinary.id,
            tokenHash: hash('ordinary-reset'),
            expiresAt: new Date(Date.now() + 60000),
          },
        });
        await tx.passwordResetToken.updateMany({
          where: { userId: ordinary.id, usedAt: null },
          data: { usedAt: new Date() },
        });
        pass(
          'Ordinary MFA login and password-reset token writes remain compatible'
        );
        await tx.user.update({
          where: { id: 9000020 },
          data: {
            theme: 'dawn',
            passwordHash: 'ordinary-reset',
            tokenVersion: { increment: 1 },
          },
        });
        await tx.user.delete({ where: { id: 9000020 } });
        pass(
          'Ordinary Prisma account create, update, reset and delete remain compatible'
        );
        await denied(
          () => tx.$executeRawUnsafe('TRUNCATE public."VerificationToken"'),
          'Runtime cannot bypass row protection with TRUNCATE'
        );
        await denied(
          () =>
            tx.$executeRawUnsafe(
              'CREATE TABLE public.qa_runtime_ddl (id integer)'
            ),
          'Runtime cannot create public objects for privilege escalation'
        );
        await denied(
          () =>
            tx.user.update({
              where: { id: 16 },
              data: { passwordHash: 'forged' },
            }),
          'Direct protected password update denied'
        );
        await denied(
          () => tx.user.update({ where: { id: 16 }, data: { role: 'ADMIN' } }),
          'Direct global-role escalation denied'
        );
        await denied(
          () =>
            tx.user.create({
              data: { id: 9000021, username: 'qa_admin_forge', role: 'ADMIN' },
            }),
          'Global administrator insertion denied'
        );
        await denied(
          () =>
            tx.verificationToken.create({
              data: {
                userId: 17,
                type: 'mfa_login:0',
                tokenHash: 'forged',
                expiresAt: new Date(Date.now() + 60000),
              },
            }),
          'Direct protected login-token insertion denied'
        );
        await denied(
          () =>
            tx.passwordResetToken.create({
              data: {
                userId: 16,
                tokenHash: 'forged',
                expiresAt: new Date(Date.now() + 60000),
              },
            }),
          'Direct protected reset-token insertion denied'
        );
        const user = await tx.user.findUnique({ where: { id: 17 } });
        const challenge = await createMfaChallenge(user, null, transactional);
        const code = speakeasy.totp({ secret: totp, encoding: 'base32' });
        const completed = await completeMfaChallenge(
          challenge,
          code,
          transactional
        );
        assert.equal(completed.ok, true, completed.error);
        assert.equal(
          (await completeMfaChallenge(challenge, code, transactional)).ok,
          false
        );
        pass(
          'Protected password/MFA login succeeds; challenge replay rejected'
        );
        await tx.$executeRawUnsafe('SET LOCAL ROLE chatforia_staff_owner');
        await tx.twoFactorRecoveryCode.create({
          data: { userId: 17, codeHash: hash('BACKUP1234') },
        });
        await tx.$executeRawUnsafe('SET LOCAL ROLE chatforia_dev');
        const backupChallenge = await createMfaChallenge(
          user,
          null,
          transactional
        );
        assert.equal(
          (
            await completeMfaChallenge(
              backupChallenge,
              'BACKUP-1234',
              transactional
            )
          ).ok,
          true
        );
        const backupReplay = await createMfaChallenge(
          user,
          null,
          transactional
        );
        assert.equal(
          (
            await completeMfaChallenge(
              backupReplay,
              'BACKUP-1234',
              transactional
            )
          ).ok,
          false
        );
        pass(
          'Protected backup-code login succeeds once and rejects code replay across challenges'
        );
        const exhausted = await createMfaChallenge(user, null, transactional);
        for (let i = 0; i < 5; i++)
          assert.equal(
            (await completeMfaChallenge(exhausted, 'INVALID', transactional))
              .ok,
            false
          );
        assert.equal(
          (await completeMfaChallenge(exhausted, code, transactional)).ok,
          false
        );
        pass(
          'MFA attempt limit cannot be bypassed by a valid code after exhaustion'
        );
        const auth = { tokenVersion: 0, mfaVerified: true };
        const changed = await grantOrChangeStaffAccess({
          actorUserId: 17,
          targetUserId: 16,
          targetProfile: 'SENIOR_ENGINEER',
          authentication: auth,
          reason: 'Integrated protected profile change',
          db: transactional,
        });
        assert.equal(changed.sessionsRevoked, true);
        const assertion = createStaffAuthorizationAssertion({
          actorUserId: 17,
          targetUserId: 18,
          action: 'STAFF_ACCESS_REVOKE',
          targetProfile: 'SUPPORT',
          ...auth,
        });
        await tx.$queryRaw`SELECT staff_security.revoke_staff_access(${assertion}, 'Integrated replay verification')`;
        await denied(
          () =>
            tx.$queryRaw`SELECT staff_security.revoke_staff_access(${assertion}, 'Integrated replay verification')`,
          'Signed delegation replay denied'
        );
        await tx.user.update({
          where: { id: 17 },
          data: { tokenVersion: { increment: 1 } },
        });
        await denied(
          () =>
            revokeStaffAccess({
              actorUserId: 17,
              targetUserId: 16,
              authentication: auth,
              reason: 'Stale session must fail',
              db: transactional,
            }),
          'Session loss prevents further delegated operations'
        );
        assert.equal(
          (await completeMfaChallenge(backupReplay, code, transactional)).ok,
          false
        );
        pass('Session version change invalidates outstanding MFA challenges');
        await tx.$executeRawUnsafe('RESET ROLE');
        assert.equal(
          (await tx.user.findUnique({ where: { id: 16 } })).tokenVersion,
          6
        );
        assert.equal(
          (await tx.user.findUnique({ where: { id: 18 } })).tokenVersion,
          3
        );
        assert.equal(await tx.staffAccessEvent.count(), 2);
        pass(
          'Integrated grant/revoke invalidate sessions and write mandatory history'
        );
        // Two separate database session identities, never the runtime login.
        const token = randomBytes(32).toString('hex');
        const passwordHash = '$2b$10$' + 'A'.repeat(53);
        await tx.$executeRawUnsafe('SET SESSION AUTHORIZATION qa_staff_issuer');
        await tx.$executeRaw`INSERT INTO staff_security.credential_recovery_approval (token_hash,target_user_id,value_hash,action,expires_at) VALUES (sha256(decode(${token},'hex')),16,sha256(convert_to(${passwordHash},'UTF8')),'PASSWORD',clock_timestamp() + interval '5 minutes')`;
        await tx.$executeRawUnsafe('RESET SESSION AUTHORIZATION');
        await tx.$executeRawUnsafe(
          'SET SESSION AUTHORIZATION qa_staff_executor'
        );
        await denied(
          () =>
            tx.$queryRaw`SELECT staff_security.execute_credential_recovery(${token},16,'PASSWORD',${passwordHash + 'x'},'Mismatched approved value rejected')`,
          'Recovery approval binds the exact credential value'
        );
        await tx.$queryRaw`SELECT staff_security.execute_credential_recovery(${token},16,'PASSWORD',${passwordHash},'Verified isolated recovery exercise')`;
        await denied(
          () =>
            tx.$queryRaw`SELECT staff_security.execute_credential_recovery(${token},16,'PASSWORD',${passwordHash},'Recovery replay must be rejected')`,
          'Protected recovery approval is single-use'
        );
        await tx.$executeRawUnsafe('RESET SESSION AUTHORIZATION');
        assert.equal(
          (await tx.user.findUnique({ where: { id: 16 } })).tokenVersion,
          7
        );
        const events =
          await tx.$queryRaw`SELECT approved_by, executed_by FROM staff_security.credential_recovery_event`;
        assert.deepEqual(events, [
          { approved_by: 'qa_staff_issuer', executed_by: 'qa_staff_executor' },
        ]);
        pass(
          'Independent operator recovery invalidates sessions and atomically audits identities'
        );
        // Replace a lost authenticator without opening a password-only login path.
        const mfaToken = randomBytes(32).toString('hex');
        const replacementSecret = speakeasy.generateSecret().base32;
        const replacementValue = seal(replacementSecret);
        await tx.$executeRawUnsafe('SET SESSION AUTHORIZATION qa_staff_issuer');
        await tx.$executeRaw`INSERT INTO staff_security.credential_recovery_approval (token_hash,target_user_id,value_hash,action,expires_at) VALUES (sha256(decode(${mfaToken},'hex')),17,sha256(convert_to(${replacementValue},'UTF8')),'MFA_REPLACE',clock_timestamp() + interval '5 minutes')`;
        await tx.$executeRawUnsafe('RESET SESSION AUTHORIZATION');
        await tx.$executeRawUnsafe(
          'SET SESSION AUTHORIZATION qa_staff_executor'
        );
        await tx.$queryRaw`SELECT staff_security.execute_credential_recovery(${mfaToken},17,'MFA_REPLACE',${replacementValue},'Verified authenticator replacement exercise')`;
        await tx.$executeRawUnsafe('RESET SESSION AUTHORIZATION');
        await tx.$executeRawUnsafe('SET LOCAL ROLE chatforia_dev');
        const recoveredUser = await tx.user.findUnique({ where: { id: 17 } });
        assert.equal(recoveredUser.twoFactorEnabled, true);
        assert.equal(
          await tx.twoFactorRecoveryCode.count({ where: { userId: 17 } }),
          0
        );
        const replacementChallenge = await createMfaChallenge(
          recoveredUser,
          null,
          transactional
        );
        assert.equal(
          (
            await completeMfaChallenge(
              replacementChallenge,
              speakeasy.totp({ secret: replacementSecret, encoding: 'base32' }),
              transactional
            )
          ).ok,
          true
        );
        await tx.$executeRawUnsafe('RESET ROLE');
        pass(
          'Independent MFA recovery preserves MFA enforcement, removes old backup codes and permits the new authenticator'
        );
        // Force an audit failure and verify credential, approval and session state.
        const rollbackToken = randomBytes(32).toString('hex');
        await tx.$executeRawUnsafe('SET SESSION AUTHORIZATION qa_staff_issuer');
        await tx.$executeRaw`INSERT INTO staff_security.credential_recovery_approval (token_hash,target_user_id,value_hash,action,expires_at) VALUES (sha256(decode(${rollbackToken},'hex')),16,sha256(convert_to(${passwordHash},'UTF8')),'PASSWORD',clock_timestamp() + interval '5 minutes')`;
        await tx.$executeRawUnsafe('RESET SESSION AUTHORIZATION');
        await tx.$executeRawUnsafe(
          'GRANT chatforia_recovery_executor TO qa_staff_issuer'
        );
        await tx.$executeRawUnsafe('SET SESSION AUTHORIZATION qa_staff_issuer');
        await denied(
          () =>
            tx.$queryRaw`SELECT staff_security.execute_credential_recovery(${rollbackToken},16,'PASSWORD',${passwordHash},'Same operator must be rejected')`,
          'Recovery rejects approval and execution by the same session identity'
        );
        await tx.$executeRawUnsafe('RESET SESSION AUTHORIZATION');
        await tx.$executeRawUnsafe(
          'REVOKE chatforia_recovery_executor FROM qa_staff_issuer'
        );
        await tx.$executeRawUnsafe(
          `CREATE FUNCTION staff_security.qa_fail_recovery_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'forced audit failure'; END $$`
        );
        await tx.$executeRawUnsafe(
          'CREATE TRIGGER qa_fail_recovery_audit BEFORE INSERT ON staff_security.credential_recovery_event FOR EACH ROW EXECUTE FUNCTION staff_security.qa_fail_recovery_audit()'
        );
        await tx.$executeRawUnsafe(
          'SET SESSION AUTHORIZATION qa_staff_executor'
        );
        await denied(
          () =>
            tx.$queryRaw`SELECT staff_security.execute_credential_recovery(${rollbackToken},16,'PASSWORD',${passwordHash},'Forced recovery audit rollback')`,
          'Recovery fails closed when mandatory audit fails'
        );
        await tx.$executeRawUnsafe('RESET SESSION AUTHORIZATION');
        assert.equal(
          (await tx.user.findUnique({ where: { id: 16 } })).tokenVersion,
          7
        );
        const approvals =
          await tx.$queryRaw`SELECT consumed_at FROM staff_security.credential_recovery_approval WHERE token_hash=sha256(decode(${rollbackToken},'hex'))`;
        assert.equal(approvals[0].consumed_at, null);
        pass(
          'Failed recovery rolls back approval consumption, credentials and session invalidation'
        );
        await tx.$executeRawUnsafe('SET LOCAL ROLE chatforia_dev');
        await denied(
          () =>
            tx.$queryRaw`SELECT staff_security.execute_credential_recovery(${rollbackToken},16,'PASSWORD',${passwordHash},'Runtime recovery bypass attempt')`,
          'Runtime database role cannot execute protected recovery'
        );
        await denied(
          () =>
            tx.$queryRaw`SELECT staff_security.mfa_login_write('{}',${'0'.repeat(64)})`,
          'Runtime database role cannot forge signed MFA mutations'
        );
        await tx.$executeRawUnsafe('RESET ROLE');

        rolled = true;
        throw new Rollback();
      },
      { timeout: 60000, isolationLevel: 'Serializable' }
    );
  } catch (error) {
    if (!(error instanceof Rollback)) throw error;
  }
  assert.equal(rolled, true);
  assert.equal(await db.user.count(), before);
  assert.equal(await db.staffAssignment.count(), 0);
  const functions =
    await db.$queryRaw`SELECT count(*)::integer AS n FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='staff_security' AND p.proname='mfa_login_write'`;
  assert.equal(functions[0].n, 0);
  pass(
    'Pending DDL, fixtures, role provisioning, approvals and mutations rolled back'
  );
  // Real competing connections exercise the same cross-operation lock used by
  // grant, revoke and recovery; no persistent fixture or migration is required.
  await db.$transaction(async (first) => {
    await first.$queryRaw`SELECT pg_advisory_xact_lock(73421,1)::text`;
    await assert.rejects(
      db.$transaction(async (second) => {
        await second.$executeRawUnsafe("SET LOCAL lock_timeout = '100ms'");
        await second.$queryRaw`SELECT pg_advisory_xact_lock(73421,1)::text`;
      })
    );
  });
  await db.$transaction(
    (tx) => tx.$queryRaw`SELECT pg_advisory_xact_lock(73421,1)::text`
  );
  pass(
    'Competing database sessions serialize; lock released after rollback/transaction end'
  );
  console.log(`Integrated checks: ${checks} passed`);
} catch (error) {
  console.error('STOP: Integrated verification failed:', error.message);
  process.exitCode = 1;
} finally {
  await db.$disconnect();
}
