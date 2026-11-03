import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash, createHmac, randomBytes, randomUUID } from 'node:crypto';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import speakeasy from 'speakeasy';

import { artifacts, freshCluster, pg } from './staff-fresh-postgres.mjs';
import { sqlStatements } from './staff-qa-sql.mjs';
import {
  captureEvidence,
  signEvidence,
  verifyEvidence,
  prepareReconciliationLedger,
  reconcileEvidence,
  assertReconciled,
} from './staff-restore-reconcile-qa.mjs';

// No input URL/archive/data directory. Both clusters are newly initialized and
// private. Restored access stays fenced until authenticated reconciliation,
// fresh independent credential recovery and the local reopening gate pass.
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
let passed = false,
  localAccessReopened = false;
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
    CREATE ROLE qa_snapshot_issuer NOLOGIN NOINHERIT;
    GRANT chatforia_recovery_issuer TO qa_snapshot_issuer;
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
  const approval = randomBytes(32).toString('hex');
  const postBackupPassword = randomBytes(32).toString('hex');
  const replacement = await bcrypt.hash(postBackupPassword, 10);
  const oldBackupCode = randomBytes(16).toString('hex').toUpperCase();
  await admin.$transaction(async (tx) => {
    await tx.$executeRawUnsafe('SET LOCAL ROLE chatforia_staff_owner');
    await tx.$executeRaw`INSERT INTO public."TwoFactorRecoveryCode" ("userId","codeHash") VALUES (2,${hash(oldBackupCode)})`;
  });
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
  const trust = {
    key: randomBytes(32),
    sourceId: randomUUID(),
    backupSha256: hash(readFileSync(dump)),
    schemaSha256: hash(
      readFileSync('docs/staff-security/migration-manifest.json')
    ),
  };
  const captured = await admin.$transaction((tx) => captureEvidence(tx), {
    isolationLevel: 'RepeatableRead',
  });
  // The fixture owns all writers. Stop the source before attesting completeness;
  // an unfenced or incomplete production journal would not satisfy this gate.
  await admin.$disconnect();
  await runtime.$disconnect();
  source.stop();
  const external = {
    ...captured,
    sourceId: trust.sourceId,
    backupSha256: trust.backupSha256,
    schemaSha256: trust.schemaSha256,
    watermark: new Date().toISOString(),
    snapshotUserIds: [1, 2, 3],
    sourceWritersStopped: true,
    complete: true,
  };
  const envelope = {
    evidence: external,
    signature: signEvidence(external, trust.key),
  };
  writeFileSync(
    join(artifacts, 'synthetic-post-backup-audits.json'),
    JSON.stringify(envelope),
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
  await prepareReconciliationLedger(restoredAdmin);
  const initialAudits = await restoredAdmin.auditLog.count();
  const initialVersions = await restored.user.findMany({
    select: { id: true, tokenVersion: true },
    orderBy: { id: 'asc' },
  });
  assert.throws(
    () =>
      verifyEvidence(
        { ...envelope, signature: envelope.signature + 'junk' },
        trust
      ),
    /encoding/
  );
  const tampered = structuredClone(envelope);
  tampered.evidence.users[2].tokenVersion = 0;
  assert.throws(() => verifyEvidence(tampered, trust), /Unauthenticated/);
  const incomplete = structuredClone(envelope);
  incomplete.evidence.complete = false;
  incomplete.signature = signEvidence(incomplete.evidence, trust.key);
  assert.throws(() => verifyEvidence(incomplete, trust), /Incomplete/);
  await assert.rejects(
    assertReconciled(restoredAdmin, envelope, trust),
    /not committed/
  );
  await assert.rejects(
    reconcileEvidence(restoredAdmin, envelope, trust, { failAudit: true }),
    (error) => error.meta?.code === '23502'
  );
  assert.equal(await restoredAdmin.staffAccessEvent.count(), 0);
  assert.equal(await restoredAdmin.auditLog.count(), initialAudits);
  assert.deepEqual(
    await restored.user.findMany({
      select: { id: true, tokenVersion: true },
      orderBy: { id: 'asc' },
    }),
    initialVersions
  );
  assert.equal(
    (
      await restoredAdmin.$queryRawUnsafe(
        'SELECT count(*)::integer AS n FROM staff_restore_qa.entry'
      )
    )[0].n,
    0
  );
  assert.equal(
    (await restored.staffAssignment.findUnique({ where: { userId: 2 } }))
      .active,
    false
  );
  pass(
    'Tampered/incomplete evidence and missing reconciliation block reopening; injected audit failure rolls back all imports and authority'
  );
  const result = await reconcileEvidence(restoredAdmin, envelope, trust);
  const reconciledDigest = await assertReconciled(
    restoredAdmin,
    envelope,
    trust
  );
  assert.equal(result.changed, true);
  const auditCount = await restoredAdmin.auditLog.count();
  assert.equal(
    (await reconcileEvidence(restoredAdmin, envelope, trust)).changed,
    false
  );
  assert.equal(await restoredAdmin.auditLog.count(), auditCount);
  // Sequence ID collisions must preserve the containment audit and import the
  // signed source record under a distinct ID with a verifiable provenance map.
  assert.equal(
    await restoredAdmin.auditLog.count({
      where: { action: 'STAFF_RESTORE_CONTAINMENT' },
    }),
    1
  );
  const mapped = await restoredAdmin.$queryRawUnsafe(
    "SELECT payload,target_key FROM staff_restore_qa.entry WHERE dataset='audits'"
  );
  assert.ok(
    mapped.some((row) => String(row.payload.id) !== row.target_key),
    'Audit collision provenance mapping missing'
  );
  assert.equal(
    (await restored.staffAssignment.findUnique({ where: { userId: 3 } }))
      .active,
    false
  );
  assert.equal(
    (await restored.staffAssignment.findUnique({ where: { userId: 2 } }))
      .active,
    true
  );
  assert.ok(
    (await restored.user.findUnique({ where: { id: 3 } })).tokenVersion >
      external.users.find((u) => u.id === 3).tokenVersion
  );
  pass(
    'Authenticated current grants/revocations, complete replay/history records and audit collision lineage reconcile atomically and idempotently'
  );
  // Post-import gate checks the actual database, not just its bookkeeping.
  for (const [mutate, expected] of [
    [
      (tx) =>
        tx.$executeRaw`DELETE FROM staff_security.consumed_assertions WHERE assertion_id=${JSON.parse(Buffer.from(assertion.split('.')[0], 'base64url').toString('utf8')).jti}::uuid`,
      'history/replay',
    ],
    [
      (tx) =>
        tx.$executeRaw`DELETE FROM staff_security.credential_recovery_approval WHERE token_hash=sha256(decode(${approval},'hex'))`,
      'Missing reconciled approval',
    ],
    [
      (tx) =>
        tx.staffAssignment.create({
          data: { userId: 1, profile: 'SUPPORT', active: true, grantedById: 1 },
        }),
      'Unapproved active grant',
    ],
    [
      (tx) =>
        tx.$executeRaw`UPDATE public."AuditLog" SET status=403 WHERE id=${Number(mapped.find((row) => String(row.payload.id) !== row.target_key).target_key)}`,
      'audit payload mismatch',
    ],
  ]) {
    await assert.rejects(
      restoredAdmin.$transaction(async (tx) => {
        await mutate(tx);
        await assert.rejects(assertReconciled(tx, envelope, trust), (error) =>
          error.message.includes(expected)
        );
        throw new Error('Roll back synthetic gate regression');
      }),
      /Roll back synthetic gate regression/
    );
  }
  await assertReconciled(restoredAdmin, envelope, trust);
  pass(
    'Missing replay/approval rows, unauthorized restored grants and changed audit payloads all block the reopening gate'
  );
  const freshRecoveries = [];
  async function freshRecovery(id, action, value) {
    const token = randomBytes(32).toString('hex');
    await restoredAdmin.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(
        'SET SESSION AUTHORIZATION qa_snapshot_issuer'
      );
      await tx.$executeRawUnsafe('SET LOCAL ROLE chatforia_recovery_issuer');
      await tx.$executeRaw`INSERT INTO staff_security.credential_recovery_approval (token_hash,target_user_id,value_hash,action,expires_at) VALUES (sha256(decode(${token},'hex')),${id},sha256(convert_to(${value},'UTF8')),${action},clock_timestamp()+interval '5 minutes')`;
      await tx.$executeRawUnsafe('RESET SESSION AUTHORIZATION');
      await tx.$executeRawUnsafe(
        'SET SESSION AUTHORIZATION qa_snapshot_executor'
      );
      await tx.$executeRawUnsafe('SET LOCAL ROLE chatforia_recovery_executor');
      await tx.$queryRaw`SELECT staff_security.execute_credential_recovery(${token}::text,${id}::integer,${action}::text,${value}::text,'Independent synthetic post-restore credential re-verification')`;
      await tx.$executeRawUnsafe('RESET SESSION AUTHORIZATION');
    });
    freshRecoveries.push({ id, action, token, value });
  }
  async function mayReopen() {
    await assertReconciled(restoredAdmin, envelope, trust);
    await assertStaffRuntimeReady(restored);
    for (const id of [1, 2, 3])
      for (const action of ['PASSWORD', 'MFA_REPLACE']) {
        const fresh = freshRecoveries.find(
          (r) => r.id === id && r.action === action
        );
        assert.ok(fresh, 'Fresh independent credential recovery incomplete');
        const [record] =
          await restoredAdmin.$queryRaw`SELECT a.consumed_at,a.approved_by,e.executed_by FROM staff_security.credential_recovery_approval a JOIN staff_security.credential_recovery_event e ON e.target_user_id=a.target_user_id AND e.action=a.action WHERE a.token_hash=sha256(decode(${fresh.token},'hex')) AND e.reason='Independent synthetic post-restore credential re-verification'`;
        assert.ok(
          record?.consumed_at &&
            record.approved_by === 'qa_snapshot_issuer' &&
            record.executed_by === 'qa_snapshot_executor',
          'Independent consumed approval/audit missing'
        );
      }
    assert.equal(
      await restored.twoFactorRecoveryCode.count({
        where: { userId: { in: [1, 2, 3] } },
      }),
      0,
      'Old backup credentials survived'
    );
    assert.equal(
      await restored.verificationToken.count({
        where: { userId: { in: [1, 2, 3] }, usedAt: null },
      }),
      0,
      'Old challenges survived'
    );
    return reconciledDigest;
  }
  await assert.rejects(mayReopen(), /credential recovery incomplete/);
  const recoveredPassword = randomBytes(24).toString('hex');
  const quarantinedPassword = randomBytes(24).toString('hex');
  let recoveredTotp;
  do {
    recoveredTotp = speakeasy.generateSecret().base32;
  } while (
    speakeasy.totp.verify({
      secret: recoveredTotp,
      encoding: 'base32',
      token: speakeasy.totp({ secret: totp, encoding: 'base32' }),
      window: 1,
    })
  );
  await freshRecovery(2, 'PASSWORD', await bcrypt.hash(recoveredPassword, 10));
  await assert.rejects(mayReopen(), /credential recovery incomplete/);
  await freshRecovery(2, 'MFA_REPLACE', seal(recoveredTotp));
  await freshRecovery(
    3,
    'PASSWORD',
    await bcrypt.hash(quarantinedPassword, 10)
  );
  await freshRecovery(
    3,
    'MFA_REPLACE',
    seal(speakeasy.generateSecret().base32)
  );
  await assert.rejects(mayReopen(), /credential recovery incomplete/);
  await freshRecovery(
    1,
    'PASSWORD',
    await bcrypt.hash(randomBytes(24).toString('hex'), 10)
  );
  await freshRecovery(
    1,
    'MFA_REPLACE',
    seal(speakeasy.generateSecret().base32)
  );
  await mayReopen();
  const recoveredUser = await restored.user.findUnique({ where: { id: 2 } });
  assert.equal(
    await bcrypt.compare(loginPassword, recoveredUser.passwordHash),
    false
  );
  assert.equal(await authorized(rotatedAuth, restored, token), false);
  assert.equal(
    await authorized(rotatedAuth, restored, oldVersionNewSignature),
    false
  );
  // Resign a previously consumed assertion using CURRENT authorized claims.
  // This would reactivate the revoked target if reconciliation lost its jti.
  const replayClaims = JSON.parse(
    Buffer.from(assertion.split('.')[0], 'base64url').toString('utf8')
  );
  Object.assign(replayClaims, {
    tokenVersion: recoveredUser.tokenVersion,
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 60,
  });
  const replayPayload = Buffer.from(JSON.stringify(replayClaims)).toString(
    'base64url'
  );
  const freshSignedReplay = `${replayPayload}.${createHmac('sha256', newStaffKey).update(replayPayload).digest('base64url')}`;
  await assert.rejects(
    restored.$queryRaw`SELECT staff_security.grant_or_change_staff_access(${freshSignedReplay},'Reconciled consumed assertion rejection')`,
    (error) => /already consumed/.test(error.meta?.message || error.message)
  );
  await assert.rejects(
    restoredAdmin.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(
        'SET SESSION AUTHORIZATION qa_snapshot_executor'
      );
      await tx.$executeRawUnsafe('SET LOCAL ROLE chatforia_recovery_executor');
      await tx.$queryRaw`SELECT staff_security.execute_credential_recovery(${approval},3,'PASSWORD',${replacement},'Old reconciled approval remains denied')`;
    }),
    (error) =>
      /invalid, expired or used/.test(error.meta?.message || error.message)
  );
  assert.equal(
    (await restored.staffAssignment.findUnique({ where: { userId: 3 } }))
      .active,
    false
  );
  await mayReopen();
  pass(
    'Fresh independent password/MFA recovery is required; old sessions, backup codes, approvals and newly signed consumed assertions remain denied'
  );
  const gate = {
    evidenceDigest: reconciledDigest,
    reconciliationComplete: true,
    credentialsReverified: true,
    approvedFor: 'synthetic-loopback-only',
  };
  const gateKey = randomBytes(32).toString('hex');
  const gatePath = join(artifacts, 'local-reopen-gate.json');
  writeFileSync(
    gatePath,
    JSON.stringify({
      gate,
      signature: createHmac('sha256', gateKey)
        .update(JSON.stringify(gate))
        .digest('hex'),
    }),
    { mode: 0o600 }
  );
  const metadata = JSON.stringify({ ...gate, productionApproval: false });
  await restoredAdmin.$transaction(async (tx) => {
    await tx.$executeRawUnsafe('SET LOCAL ROLE chatforia_staff_owner');
    await tx.$executeRaw`INSERT INTO public."AuditLog" ("actorId",action,resource,"resourceId",status,metadata) VALUES (1,'STAFF_RESTORE_LOCAL_REOPEN_APPROVED','staff_restore',${reconciledDigest},200,${metadata}::jsonb)`;
  });
  const reopened = execFileSync(
    process.execPath,
    ['server/scripts/staff-recovered-access-probe.mjs'],
    {
      encoding: 'utf8',
      env: {
        PATH: process.env.PATH,
        NODE_ENV: 'test',
        JEST_WORKER_ID: 'synthetic-recovery-probe',
        DOTENV_CONFIG_PATH: '/dev/null',
        DATABASE_URL: target.url('staff_old_restore', 'chatforia_dev'),
        TEST_DATABASE_URL: target.url('staff_old_restore', 'chatforia_dev'),
        JWT_SECRET: newJwtKey,
        APP_ENC_KEY: process.env.APP_ENC_KEY,
        STAFF_ACCESS_SIGNING_SECRET: newStaffKey,
        STAFF_SECURITY_ENABLED: 'true',
        STAFF_DASHBOARD_ENABLED: 'true',
        STRIPE_SECRET_KEY: 'sk_test_offline_synthetic_only',
        SESSION_SECRET: randomBytes(32).toString('hex'),
        STAFF_REOPEN_GATE: gatePath,
        STAFF_REOPEN_GATE_KEY: gateKey,
        STAFF_REOPEN_DIGEST: reconciledDigest,
        STAFF_RECOVERED_PASSWORD: recoveredPassword,
        STAFF_RECOVERED_TOTP: recoveredTotp,
        STAFF_OLD_PASSWORD: loginPassword,
        STAFF_POST_BACKUP_PASSWORD: postBackupPassword,
        STAFF_OLD_TOTP: totp,
        STAFF_OLD_BACKUP: oldBackupCode,
        STAFF_OLD_SESSION: token,
        STAFF_OLD_VERSION_SESSION: oldVersionNewSignature,
      },
      maxBuffer: 4 * 1024 * 1024,
    }
  );
  writeFileSync(join(artifacts, 'private-reopened-probe.log'), reopened, {
    mode: 0o600,
  });
  localAccessReopened = true;
  pass(
    'Only after reconciliation and credential gates, loopback HTTP denies revoked credentials and permits legitimate recovered MFA/least-privilege access'
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
        trafficReopened: localAccessReopened,
        productionAccessReopened: false,
        artifacts,
        clustersStopped: true,
      },
      null,
      2
    ),
    { mode: 0o600 }
  );
}
