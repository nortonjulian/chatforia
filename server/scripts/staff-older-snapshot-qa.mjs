import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import speakeasy from 'speakeasy';

import { artifacts, freshCluster, pg } from './staff-fresh-postgres.mjs';
import { sqlStatements } from './staff-qa-sql.mjs';

// No input URL/archive/data directory. Both clusters are newly initialized and
// private. Only the source gets a temporary loopback HTTP probe; no restored
// service listener is created and restored traffic stays fenced throughout.
const checks = [],
  clusters = [],
  clients = [];
const pass = (name) => {
  checks.push(name);
  console.log('PASS:', name);
};
const db = (url) => {
  const client = new PrismaClient({ datasources: { db: { url } } });
  clients.push(client);
  return client;
};
const hash = (s) => createHash('sha256').update(s).digest('hex');
const oldJwtKey = randomBytes(32).toString('hex');
process.env.JWT_SECRET = oldJwtKey;
process.env.APP_ENC_KEY = randomBytes(32).toString('base64');
process.env.STAFF_ACCESS_SIGNING_SECRET = randomBytes(32).toString('hex');
process.env.STAFF_SECURITY_ENABLED = 'true';
process.env.STAFF_DASHBOARD_ENABLED = 'false';
process.env.NODE_ENV = 'development';
let passed = false;
try {
  const source = await freshCluster('source');
  clusters.push(source);
  source.sql('postgres', 'CREATE DATABASE staff_old_source');
  process.env.DATABASE_URL = source.url('staff_old_source', 'chatforia_dev');
  const admin = db(source.url('staff_old_source'));
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
    { encoding: 'utf8' }
  );
  for (const sql of sqlStatements(ddl)) await admin.$executeRawUnsafe(sql);
  source.sql(
    'staff_old_source',
    `
    CREATE ROLE chatforia_dev LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
    CREATE ROLE chatforia_recovery_issuer NOLOGIN NOINHERIT;
    CREATE ROLE chatforia_recovery_executor NOLOGIN NOINHERIT;
    ${readFileSync('server/scripts/staff-access-bootstrap-role.sql', 'utf8')}
    CREATE ROLE qa_snapshot_executor NOLOGIN NOINHERIT;
    GRANT chatforia_recovery_executor TO qa_snapshot_executor;
  `
  );
  for (const name of readdirSync('server/prisma/migrations')
    .filter((n) => n.startsWith('20261102') && n >= '20261102070000')
    .sort())
    for (const sql of sqlStatements(
      readFileSync(`server/prisma/migrations/${name}/migration.sql`, 'utf8')
    ))
      await admin.$executeRawUnsafe(sql);
  const { seal } = await import('../utils/secretBox.js');
  const totp = speakeasy.generateSecret().base32;
  const loginPassword = randomBytes(24).toString('hex');
  const loginHash = await bcrypt.hash(loginPassword, 10);
  await admin.user.createMany({
    data: [1, 2, 3].map((id) => ({
      id,
      username: `old_snapshot_${id}`,
      usernameNorm: `old_snapshot_${id}`,
      passwordHash: loginHash,
      twoFactorEnabled: true,
      totpSecretEnc: seal(totp),
      twoFactorEnrolledAt: new Date(),
      emailVerifiedAt: new Date(),
    })),
  });
  await admin.founderOwnership.create({
    data: {
      id: 1,
      userId: 1,
      verificationRef: 'synthetic-older-snapshot-only',
    },
  });
  await admin.staffAssignment.createMany({
    data: [
      { userId: 2, profile: 'ACCESS_ADMIN', grantedById: 1, active: true },
      { userId: 3, profile: 'SUPPORT', grantedById: 2, active: true },
    ],
  });
  await admin.$executeRaw`INSERT INTO staff_security.assertion_secrets (id,key_version,verification_secret) VALUES (1,1,convert_to(${process.env.STAFF_ACCESS_SIGNING_SECRET},'UTF8'))`;
  const approval = randomBytes(32).toString('hex'),
    replacement = await bcrypt.hash(randomBytes(32).toString('hex'), 10);
  await admin.$executeRaw`INSERT INTO staff_security.credential_recovery_approval (token_hash,target_user_id,value_hash,action,expires_at) VALUES (sha256(decode(${approval},'hex')),3,sha256(convert_to(${replacement},'UTF8')),'PASSWORD',clock_timestamp()+interval '10 minutes')`;
  const runtime = db(source.url('staff_old_source', 'chatforia_dev'));
  const { createStaffAuthorizationAssertion } = await import(
    '../security/staffAuthorizationAssertion.js'
  );
  const { revokeStaffAccess } = await import(
    '../security/staffRevocationService.js'
  );
  const { requireAuth } = await import('../middleware/auth.js');
  const { assertStaffRuntimeReady } = await import(
    '../security/staffRuntimeReadiness.js'
  );
  const assertion = createStaffAuthorizationAssertion({
    actorUserId: 2,
    targetUserId: 3,
    action: 'STAFF_ACCESS_GRANT_OR_CHANGE',
    targetProfile: 'SUPPORT',
    tokenVersion: 0,
    mfaVerified: true,
  });
  const token = jwt.sign(
    { id: 3, tokenVersion: 0, mfaVerified: true, typ: 'session' },
    oldJwtKey,
    { expiresIn: '5m' }
  );
  async function authorized(authenticate, client, session) {
    let ok = false;
    await authenticate(
      { headers: { authorization: `Bearer ${session}` } },
      {
        status() {
          return this;
        },
        json() {},
      },
      () => {
        ok = true;
      },
      client
    );
    return ok;
  }
  // Missing full-app password/TOTP API evidence, with no inherited provider
  // credentials and no real Redis/OAuth/payment service access.
  const authOutput = execFileSync(
    process.execPath,
    ['server/scripts/staff-full-auth-probe.mjs'],
    {
      encoding: 'utf8',
      env: {
        PATH: process.env.PATH,
        NODE_ENV: 'test',
        JEST_WORKER_ID: 'synthetic-probe',
        DOTENV_CONFIG_PATH: '/dev/null',
        DATABASE_URL: source.url('staff_old_source', 'chatforia_dev'),
        TEST_DATABASE_URL: source.url('staff_old_source', 'chatforia_dev'),
        JWT_SECRET: oldJwtKey,
        APP_ENC_KEY: process.env.APP_ENC_KEY,
        STAFF_ACCESS_SIGNING_SECRET: process.env.STAFF_ACCESS_SIGNING_SECRET,
        STAFF_SECURITY_ENABLED: 'true',
        STAFF_DASHBOARD_ENABLED: 'true',
        STRIPE_SECRET_KEY: 'sk_test_offline_synthetic_only',
        SESSION_SECRET: randomBytes(32).toString('hex'),
        STAFF_SYNTHETIC_AUTH_PROBE: 'fresh-cluster-only',
        STAFF_SYNTHETIC_PASSWORD: loginPassword,
        STAFF_SYNTHETIC_TOTP: totp,
      },
      maxBuffer: 4 * 1024 * 1024,
    }
  );
  writeFileSync(join(artifacts, 'private-full-auth-probe.log'), authOutput, {
    mode: 0o600,
  });
  pass(
    'Real full-app factory password/TOTP/cookie staff access and administrator denial pass with synthetic runtime'
  );
  const dump = join(artifacts, 'older-synthetic.dump'),
    globals = join(artifacts, 'older-synthetic-roles.sql');
  pg('pg_dump', [
    ...source.connection('staff_old_source'),
    '--format=custom',
    '--file',
    dump,
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
    globals,
  ]);
  // Changes deliberately happen AFTER the backup, unlike the exact-snapshot QA.
  await runtime.$queryRaw`SELECT staff_security.grant_or_change_staff_access(${assertion},'Synthetic post-backup assertion consumption')`;
  await revokeStaffAccess({
    actorUserId: 2,
    targetUserId: 3,
    authentication: { tokenVersion: 0, mfaVerified: true },
    reason: 'Synthetic post-backup staff revocation',
    db: runtime,
  });
  await admin.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(
      'SET SESSION AUTHORIZATION qa_snapshot_executor'
    );
    await tx.$executeRawUnsafe('SET LOCAL ROLE chatforia_recovery_executor');
    await tx.$queryRaw`SELECT staff_security.execute_credential_recovery(${approval},3,'PASSWORD',${replacement},'Synthetic post-backup operator recovery')`;
    await tx.$executeRawUnsafe('RESET SESSION AUTHORIZATION');
  });
  assert.equal(await authorized(requireAuth, runtime, token), false);
  const external = {
    staff: await admin.staffAccessEvent.findMany(),
    audit: await admin.auditLog.findMany(),
    recovery: await admin.$queryRawUnsafe(
      'SELECT target_user_id,action,approved_by,executed_by,reason,created_at FROM staff_security.credential_recovery_event'
    ),
  };
  writeFileSync(
    join(artifacts, 'synthetic-post-backup-audits.json'),
    JSON.stringify(external),
    { mode: 0o600 }
  );
  pass(
    'Backup precedes real revocation, assertion consumption and independent-operator recovery; source denies old session'
  );
  const target = await freshCluster('restore');
  clusters.push(target);
  target.sql(
    'postgres',
    readFileSync(globals, 'utf8').replace('CREATE ROLE staff_source_admin;', '')
  );
  target.sql('postgres', 'CREATE DATABASE staff_old_restore');
  pg('pg_restore', [
    ...target.connection('staff_old_restore'),
    '--exit-on-error',
    '--single-transaction',
    dump,
  ]);
  const restoredAdmin = db(target.url('staff_old_restore')),
    restored = db(target.url('staff_old_restore', 'chatforia_dev'));
  assert.equal(await authorized(requireAuth, restored, token), true);
  assert.equal(
    (await restored.staffAssignment.findUnique({ where: { userId: 3 } }))
      .active,
    true
  );
  assert.equal(await restoredAdmin.staffAccessEvent.count(), 0);
  assert.equal(
    (
      await restoredAdmin.$queryRawUnsafe(
        'SELECT count(*)::integer AS n FROM staff_security.credential_recovery_approval WHERE consumed_at IS NULL'
      )
    )[0].n,
    1
  );
  // Expected hazard, exercised only offline: old snapshot forgot consumption.
  await restored.$queryRaw`SELECT staff_security.grant_or_change_staff_access(${assertion},'Synthetic offline restored replay hazard')`;
  pass(
    'Offline older restore reproduces resurrected session/grant, forgotten assertion consumption and lost post-backup audits'
  );
  const newJwtKey = randomBytes(32).toString('hex'),
    newStaffKey = randomBytes(32).toString('hex');
  process.env.JWT_SECRET = newJwtKey;
  process.env.STAFF_ACCESS_SIGNING_SECRET = newStaffKey;
  await restoredAdmin.$transaction(async (tx) => {
    await tx.$executeRawUnsafe('SET LOCAL ROLE chatforia_staff_owner');
    await tx.$executeRaw`UPDATE staff_security.assertion_secrets SET verification_secret=convert_to(${newStaffKey},'UTF8'),key_version=key_version+1 WHERE id=1`;
    await tx.user.updateMany({ data: { tokenVersion: { increment: 1 } } });
    await tx.staffAssignment.updateMany({
      where: { active: true },
      data: { active: false, revokedAt: new Date(), revokedById: 1 },
    });
    await tx.$executeRawUnsafe(
      "UPDATE staff_security.credential_recovery_approval SET expires_at=created_at+interval '1 microsecond' WHERE consumed_at IS NULL"
    );
    const metadata = JSON.stringify({
      trafficFenced: true,
      externalAuditSha256: hash(JSON.stringify(external)),
      reopenApproved: false,
    });
    // The restricted owner has INSERT only; Prisma's default RETURNING would
    // unnecessarily demand SELECT. Match the protected SQL entry points.
    await tx.$executeRaw`INSERT INTO public."AuditLog" ("actorId",action,resource,"resourceId",status,metadata) VALUES (1,'STAFF_RESTORE_CONTAINMENT','staff_restore','synthetic-old-snapshot',200,${metadata}::jsonb)`;
  });
  const { requireAuth: rotatedAuth } = await import(
    `../middleware/auth.js?syntheticRotation=${Date.now()}`
  );
  assert.equal(await authorized(rotatedAuth, restored, token), false);
  const oldVersionNewSignature = jwt.sign(
    { id: 3, tokenVersion: 0, mfaVerified: true },
    newJwtKey,
    { expiresIn: '5m' }
  );
  assert.equal(
    await authorized(rotatedAuth, restored, oldVersionNewSignature),
    false
  );
  await assert.rejects(
    restored.$queryRaw`SELECT staff_security.grant_or_change_staff_access(${assertion},'Synthetic old signature denied after containment')`,
    (error) =>
      /Invalid staff assertion signature/.test(
        error.meta?.message || error.message
      )
  );
  assert.equal(
    await restored.staffAssignment.count({ where: { active: true } }),
    0
  );
  await assert.rejects(
    restoredAdmin.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(
        'SET SESSION AUTHORIZATION qa_snapshot_executor'
      );
      await tx.$executeRawUnsafe('SET LOCAL ROLE chatforia_recovery_executor');
      await tx.$queryRaw`SELECT staff_security.execute_credential_recovery(${approval},3,'PASSWORD',${replacement},'Synthetic restored approval denied after containment')`;
    }),
    (error) =>
      /Recovery approval invalid, expired or used/.test(
        error.meta?.message || error.message
      )
  );
  pass(
    'Fenced containment rotates JWT/assertion keys, increments versions, revokes restored staff access and expires restored approvals'
  );
  await assertStaffRuntimeReady(restored);
  const { createMfaChallenge, completeMfaChallenge } = await import(
    '../services/mfaLogin.js'
  );
  const user = await restored.user.findUnique({ where: { id: 3 } });
  const challenge = await createMfaChallenge(user, null, restored);
  assert.equal(
    (
      await completeMfaChallenge(
        challenge,
        speakeasy.totp({ secret: totp, encoding: 'base32' }),
        restored
      )
    ).ok,
    true
  );
  assert.equal(process.env.STAFF_DASHBOARD_ENABLED, 'false');
  assert.equal(
    (
      await restoredAdmin.auditLog.findFirst({
        where: { action: 'STAFF_RESTORE_CONTAINMENT' },
      })
    ).metadata.reopenApproved,
    false
  );
  pass(
    'Rotated-key readiness and fresh protected MFA/token writes succeed; external synthetic audits retained; traffic stays fenced'
  );
  passed = true;
} finally {
  for (const client of clients.reverse()) await client.$disconnect();
  for (const cluster of clusters.reverse()) cluster.stop();
  writeFileSync(
    '/tmp/chatforia-staff-older-snapshot-report.json',
    JSON.stringify(
      {
        passed,
        checks,
        syntheticOnly: true,
        existingInfrastructureAccessed: false,
        trafficReopened: false,
        artifacts,
        clustersStopped: true,
      },
      null,
      2
    ),
    { mode: 0o600 }
  );
}
