import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash, createHmac, randomBytes } from 'node:crypto';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { PrismaClient } from '@prisma/client';
import speakeasy from 'speakeasy';
import { artifacts, freshCluster, pg } from './staff-fresh-postgres.mjs';
import { sqlStatements } from './staff-qa-sql.mjs';

// No existing database URL, dataset or archive is read by this rehearsal.
process.env.NODE_ENV = 'development';
process.env.APP_ENC_KEY = randomBytes(32).toString('base64');
process.env.JWT_SECRET = randomBytes(32).toString('hex');
process.env.STAFF_ACCESS_SIGNING_SECRET = randomBytes(32).toString('hex');
process.env.STAFF_SECURITY_ENABLED = 'true';
process.env.STAFF_DASHBOARD_ENABLED = 'true';
process.env.STAFF_DASHBOARD_USER_IDS = '14,16,17,18';
process.env.STAFF_QA_TOTP = speakeasy.generateSecret().base32;
const started = Date.now(),
  checks = [];
const pass = (name) => {
  checks.push(name);
  console.log('PASS:', name);
};
const clusters = [],
  clients = [];
let browserResult,
  browserError,
  error,
  cleanupError,
  phase = 'fresh source cluster';
const client = (url) => {
  const db = new PrismaClient({ datasources: { db: { url } } });
  clients.push(db);
  return db;
};
const digest = (value) =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex');
async function snapshot(db) {
  const result = {};
  for (const [schema, table] of [
    ['public', 'User'],
    ['public', 'FounderOwnership'],
    ['public', 'StaffAssignment'],
    ['public', 'StaffAccessEvent'],
    ['public', 'AuditLog'],
    ['public', 'Report'],
    ['public', 'PasswordResetToken'],
    ['public', 'VerificationToken'],
    ['public', 'TwoFactorRecoveryCode'],
    ['staff_security', 'assertion_secrets'],
    ['staff_security', 'consumed_assertions'],
    ['staff_security', 'credential_recovery_approval'],
    ['staff_security', 'credential_recovery_event'],
    ['staff_security', 'mfa_login_assertions'],
  ]) {
    const rows = await db.$queryRawUnsafe(
      `SELECT to_jsonb(t) AS row FROM "${schema}"."${table}" t ORDER BY to_jsonb(t)::text`
    );
    result[`${schema}.${table}`] = { rows: rows.length, sha256: digest(rows) };
  }
  return result;
}
try {
  const source = await freshCluster('source');
  clusters.push(source);
  source.sql('postgres', 'CREATE DATABASE staff_source_test;');
  process.env.DATABASE_URL = source.url('staff_source_test', 'chatforia_dev');
  const ddl = execFileSync(
    process.execPath,
    [
      'node_modules/prisma/build/index.js',
      'migrate',
      'diff',
      '--from-empty',
      '--to-schema-datamodel',
      'server/prisma/schema.prisma',
      '--script',
    ],
    { encoding: 'utf8', env: { ...process.env }, maxBuffer: 16 * 1024 * 1024 }
  );
  const admin = client(source.url('staff_source_test'));
  for (const sql of sqlStatements(ddl)) await admin.$executeRawUnsafe(sql);
  await admin.$executeRawUnsafe(
    'CREATE ROLE chatforia_dev LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS'
  );
  await admin.$executeRawUnsafe(
    'CREATE ROLE chatforia_recovery_issuer NOLOGIN NOINHERIT'
  );
  await admin.$executeRawUnsafe(
    'CREATE ROLE chatforia_recovery_executor NOLOGIN NOINHERIT'
  );
  for (const sql of sqlStatements(
    readFileSync('server/scripts/staff-access-bootstrap-role.sql', 'utf8')
  ))
    await admin.$executeRawUnsafe(sql);
  const names = readdirSync('server/prisma/migrations')
    .filter((name) => name.startsWith('20261102') && name >= '20261102070000')
    .sort();
  for (const name of names)
    for (const sql of sqlStatements(
      readFileSync(`server/prisma/migrations/${name}/migration.sql`, 'utf8')
    ))
      await admin.$executeRawUnsafe(sql);
  await admin.$executeRaw`INSERT INTO staff_security.assertion_secrets (id,key_version,verification_secret) VALUES (1,3,convert_to(${process.env.STAFF_ACCESS_SIGNING_SECRET},'UTF8'))`;
  const { seal } = await import('../utils/secretBox.js');
  await admin.user.createMany({
    data: [13, 14, 16, 17, 18, 19].map((id) => ({
      id,
      username: `synthetic_staff_${id}`,
      passwordHash: 'synthetic-unusable-password',
      emailVerifiedAt: new Date(),
      twoFactorEnabled: true,
      twoFactorEnrolledAt: new Date(),
      totpSecretEnc: seal(process.env.STAFF_QA_TOTP),
      tokenVersion: id === 16 ? 5 : id === 18 ? 2 : 0,
    })),
  });
  await admin.user.update({ where: { id: 19 }, data: { role: 'ADMIN' } });
  await admin.user.createMany({
    data: [
      ...Array.from({ length: 27 }, (_, index) => ({
        id: 100 + index,
        username: `synthetic_user_${index}`,
        displayName: index === 0 ? 'Current user display' : null,
        passwordHash: 'synthetic-unusable-password',
      })),
      {
        id: 999,
        username: '<img src=x onerror="window.__staffXss=1">',
        passwordHash: 'synthetic-unusable-password',
      },
    ],
  });
  await admin.founderOwnership.create({
    data: {
      id: 1,
      userId: 13,
      verificationRef: 'new-cluster-synthetic-rehearsal',
    },
  });
  await admin.staffAssignment.createMany({
    data: [
      { userId: 14, profile: 'CTO', grantedById: 13 },
      { userId: 16, profile: 'SUPPORT', grantedById: 17 },
      { userId: 17, profile: 'ACCESS_ADMIN', grantedById: 13 },
      { userId: 18, profile: 'SUPPORT', grantedById: 17 },
    ].map((row) => ({ ...row, active: true })),
  });
  await admin.report.create({
    data: {
      id: 28,
      reporterId: 17,
      reportedUserId: 16,
      decryptedContent: 'Synthetic report only',
      reason: 'Browser QA',
    },
  });
  const runtime = client(source.url('staff_source_test', 'chatforia_dev'));
  const { assertStaffRuntimeReady } = await import(
    '../security/staffRuntimeReadiness.js'
  );
  await assertStaffRuntimeReady(runtime);
  pass(
    'Fresh verified cluster contains only generated schema, restricted roles and synthetic fixtures'
  );
  phase = 'Chromium dashboard QA';
  const { browserQa } = await import('./staff-browser-qa.mjs');
  try {
    browserResult = await browserQa({ runtime, admin, artifacts, pass });
  } catch (caught) {
    browserError = { name: caught.name };
    writeFileSync(
      join(artifacts, 'private-browser-error.log'),
      String(caught.stack),
      { mode: 0o600 }
    );
    console.error(
      'Browser QA failed; continuing the independent synthetic restore rehearsal.'
    );
  }
  // Make the restore's synthetic session/revocation assertions independent of
  // browser availability; never changes an existing database or fixture set.
  const { grantOrChangeStaffAccess } = await import(
    '../security/staffGrantService.js'
  );
  const { revokeStaffAccess } = await import(
    '../security/staffRevocationService.js'
  );
  const authentication = { mfaVerified: true, tokenVersion: 0 };
  if (
    (await admin.staffAssignment.findUnique({ where: { userId: 16 } }))
      .profile !== 'SENIOR_ENGINEER'
  )
    await grantOrChangeStaffAccess({
      actorUserId: 17,
      targetUserId: 16,
      targetProfile: 'SENIOR_ENGINEER',
      authentication,
      reason: 'Synthetic restore invalidation fixture',
      db: runtime,
    });
  if (
    (await admin.staffAssignment.findUnique({ where: { userId: 18 } })).active
  )
    await revokeStaffAccess({
      actorUserId: 17,
      targetUserId: 18,
      authentication,
      reason: 'Synthetic restore revocation fixture',
      db: runtime,
    });
  await admin.$executeRawUnsafe('CREATE ROLE qa_staff_issuer NOLOGIN');
  await admin.$executeRawUnsafe('CREATE ROLE qa_staff_executor NOLOGIN');
  await admin.$executeRawUnsafe(
    'GRANT chatforia_recovery_issuer TO qa_staff_issuer'
  );
  await admin.$executeRawUnsafe(
    'GRANT chatforia_recovery_executor TO qa_staff_executor'
  );
  const approval = randomBytes(32).toString('hex');
  const { default: bcrypt } = await import('bcrypt');
  const replacement = await bcrypt.hash(randomBytes(32).toString('hex'), 10);
  await admin.$transaction(async (tx) => {
    await tx.$executeRawUnsafe('SET SESSION AUTHORIZATION qa_staff_issuer');
    await tx.$executeRaw`INSERT INTO staff_security.credential_recovery_approval (token_hash,target_user_id,value_hash,action,expires_at) VALUES (sha256(decode(${approval},'hex')),14,sha256(convert_to(${replacement},'UTF8')),'PASSWORD',clock_timestamp() + interval '5 minutes')`;
    await tx.$executeRawUnsafe('RESET SESSION AUTHORIZATION');
    await tx.$executeRawUnsafe('SET SESSION AUTHORIZATION qa_staff_executor');
    await tx.$queryRaw`SELECT staff_security.execute_credential_recovery(${approval},14,'PASSWORD',${replacement},'Synthetic restore recovery evidence')`;
    await tx.$executeRawUnsafe('RESET SESSION AUTHORIZATION');
  });
  pass(
    'Synthetic recovery approval consumption and independent-operator audit exist before backup'
  );
  phase = 'synthetic logical backup';
  const before = await snapshot(admin);
  const archive = join(artifacts, 'synthetic-staff.dump'),
    roles = join(artifacts, 'synthetic-roles.sql');
  pg('pg_dump', [
    ...source.connection('staff_source_test'),
    '--format=custom',
    '--file',
    archive,
  ]);
  pg('pg_dumpall', [
    '-h',
    '127.0.0.1',
    '-p',
    String(source.port),
    '-U',
    source.admin,
    '--roles-only',
    '--no-role-passwords',
    '--file',
    roles,
  ]);
  const restoreStarted = Date.now();
  const restore = await freshCluster('restore');
  clusters.push(restore);
  const roleDump = readFileSync(roles, 'utf8');
  assert.equal(roleDump.split('CREATE ROLE staff_source_admin;').length, 2);
  // Both fresh clusters use the same bootstrap identity so GRANTED BY retains
  // its authority. Only that already-created bootstrap CREATE is omitted.
  restore.sql(
    'postgres',
    roleDump.replace('CREATE ROLE staff_source_admin;', '')
  );
  restore.sql(
    'postgres',
    'CREATE DATABASE staff_restore_test OWNER staff_source_admin;'
  );
  pg('pg_restore', [
    ...restore.connection('staff_restore_test'),
    '--exit-on-error',
    '--single-transaction',
    archive,
  ]);
  const restoredAdmin = client(restore.url('staff_restore_test'));
  const restoredRuntime = client(
    restore.url('staff_restore_test', 'chatforia_dev')
  );
  assert.deepEqual(await snapshot(restoredAdmin), before);
  pass(
    'pg_dump/pg_restore into a second fresh cluster preserves all 14 critical account, audit, approval and replay datasets'
  );
  await assertStaffRuntimeReady(restoredRuntime);
  pass(
    'Restored roles, owners, ACLs, triggers, functions and signing-key match pass runtime readiness'
  );
  const { createMfaChallenge, completeMfaChallenge } = await import(
    '../services/mfaLogin.js'
  );
  const restoredUser = await restoredRuntime.user.findUnique({
    where: { id: 17 },
  });
  const restoredChallenge = await createMfaChallenge(
    restoredUser,
    null,
    restoredRuntime
  );
  const restoredLogin = await completeMfaChallenge(
    restoredChallenge,
    speakeasy.totp({ secret: process.env.STAFF_QA_TOTP, encoding: 'base32' }),
    restoredRuntime
  );
  assert.equal(restoredLogin.ok, true);
  pass(
    'Restored protected MFA succeeds with retained external keys and fresh token/sequence writes'
  );
  const { requireAuth } = await import('../middleware/auth.js');
  const { default: jwt } = await import('jsonwebtoken');
  async function authenticate(id, version) {
    let status,
      authorized = false;
    const token = jwt.sign(
      { id, tokenVersion: version, mfaVerified: true, typ: 'session' },
      process.env.JWT_SECRET,
      { expiresIn: '5m' }
    );
    await requireAuth(
      { headers: { authorization: `Bearer ${token}` } },
      {
        status(code) {
          status = code;
          return this;
        },
        json() {},
      },
      () => {
        authorized = true;
      },
      restoredRuntime
    );
    return { status, authorized };
  }
  assert.equal((await authenticate(16, 5)).status, 401);
  assert.equal((await authenticate(18, 2)).status, 401);
  assert.equal((await authenticate(17, 0)).authorized, true);
  await assert.rejects(
    restoredRuntime.user.update({
      where: { id: 17 },
      data: { passwordHash: 'forged' },
    })
  );
  await assert.rejects(
    restoredRuntime.staffAssignment.update({
      where: { userId: 18 },
      data: { active: true },
    })
  );
  pass(
    'Restored database rejects invalidated sessions and direct privilege/credential writes'
  );
  const replay =
    await restoredAdmin.$queryRaw`SELECT assertion_id FROM staff_security.consumed_assertions LIMIT 1`;
  assert.equal(replay.length, 1);
  await assert.rejects(
    restoredRuntime.$queryRaw`SELECT * FROM staff_security.assertion_secrets`
  );
  assert.equal(
    (await restoredAdmin.staffAssignment.findUnique({ where: { userId: 18 } }))
      .active,
    false
  );
  const consumed =
    await restoredAdmin.$queryRaw`SELECT * FROM staff_security.consumed_assertions WHERE action='STAFF_ACCESS_GRANT_OR_CHANGE' LIMIT 1`;
  const { createStaffAuthorizationAssertion } = await import(
    '../security/staffAuthorizationAssertion.js'
  );
  const generated = createStaffAuthorizationAssertion({
    actorUserId: 17,
    targetUserId: 16,
    action: 'STAFF_ACCESS_GRANT_OR_CHANGE',
    targetProfile: 'SENIOR_ENGINEER',
    tokenVersion: 0,
    mfaVerified: true,
  });
  const claims = JSON.parse(
    Buffer.from(generated.split('.')[0], 'base64url').toString('utf8')
  );
  claims.jti = consumed[0].assertion_id;
  const payload = Buffer.from(JSON.stringify(claims)).toString('base64url');
  const replayAssertion = `${payload}.${createHmac('sha256', process.env.STAFF_ACCESS_SIGNING_SECRET).update(payload).digest('base64url')}`;
  await assert.rejects(
    restoredRuntime.$queryRaw`SELECT staff_security.grant_or_change_staff_access(${replayAssertion},'Restored assertion replay rejection')`,
    (caught) => /already consumed/.test(caught.meta?.message || caught.message)
  );
  await assert.rejects(
    restoredAdmin.$transaction(async (tx) => {
      await tx.$executeRawUnsafe('SET SESSION AUTHORIZATION qa_staff_executor');
      await tx.$queryRaw`SELECT staff_security.execute_credential_recovery(${approval},14,'PASSWORD',${replacement},'Restored recovery replay rejection')`;
    })
  );
  assert.equal(
    (
      await restoredAdmin.$queryRaw`SELECT count(*)::integer AS total FROM staff_security.credential_recovery_event`
    )[0].total,
    1
  );
  pass(
    'Restored consumed authorization and recovery approvals cannot be replayed; recovery audit is intact'
  );
  pass(
    'Restored revocation, replay registry and secret-table isolation are retained'
  );
  writeFileSync(
    join(artifacts, 'restore-evidence.json'),
    JSON.stringify(
      {
        source: 'staff_source_test',
        restored: 'staff_restore_test',
        datasetDigests: before,
        restoreDurationMs: Date.now() - restoreStarted,
      },
      null,
      2
    ),
    { mode: 0o600 }
  );
  if (browserError) process.exitCode = 1;
} catch (caught) {
  error = { phase, name: caught.name, code: caught.code || null };
  writeFileSync(join(artifacts, 'private-error.log'), String(caught.stack), {
    mode: 0o600,
  });
  console.error(
    'STOP: Local rehearsal failed during',
    phase,
    `(${caught.name}); private diagnostic retained in the isolated artifact directory.`
  );
  process.exitCode = 1;
} finally {
  for (const db of clients.reverse()) await db.$disconnect().catch(() => {});
  for (const cluster of clusters.reverse()) {
    try {
      cluster.stop();
    } catch (caught) {
      cleanupError = { cluster: cluster.label, name: caught.name };
      process.exitCode = 1;
    }
  }
  const report = {
    revision: execFileSync('git', ['rev-parse', 'HEAD'], {
      encoding: 'utf8',
    }).trim(),
    syntheticOnly: true,
    worktreeDirty: Boolean(
      execFileSync('git', ['status', '--porcelain'], {
        encoding: 'utf8',
      }).trim()
    ),
    postgresVersion: pg('postgres', ['--version']).trim(),
    existingDatabasesContacted: false,
    durationMs: Date.now() - started,
    passed: !error && !cleanupError && !browserError,
    checks,
    browser: browserResult,
    browserError,
    error,
    cleanupError,
    artifacts,
    clustersStopped: !cleanupError,
  };
  writeFileSync(
    '/tmp/chatforia-staff-local-rehearsal.json',
    JSON.stringify(report, null, 2) + '\n',
    { mode: 0o600 }
  );
  console.log('Report: /tmp/chatforia-staff-local-rehearsal.json');
  console.log('Synthetic artifacts:', artifacts);
}
