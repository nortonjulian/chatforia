import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, copyFileSync, rmSync, writeFileSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { PrismaClient } from '@prisma/client';
import { applicationReleaseSpec, buildPackage, checksForPending, verifyPackage, digest } from './migration-package.mjs';
import { aggregateChecks, assertChecks } from './deploy-migration-package.mjs';
import { runApplicationReleasePreflight } from './application-release-preflight.mjs';
import { recover, failedAttempt, checkRecoveryRole } from './mfa-165-recovery.mjs';
import { dispatchVoicemailEmailOnce } from '../jobs/voicemailEmailDispatcher.js';

assert.equal(process.env.GITHUB_ACTIONS, 'true');
assert.equal(process.env.GITHUB_EVENT_NAME, 'pull_request');
assert.equal(process.env.GITHUB_REPOSITORY, 'nortonjulian/chatforia');
assert.equal(process.env.APPLICATION_RELEASE_SYNTHETIC_PG18, 'yes');
const url = new URL(process.env.DATABASE_URL);
assert.equal(url.hostname, '127.0.0.1');
assert.equal(url.pathname, '/chatforia_application_release_test');
const db = new PrismaClient();
const root = mkdtempSync(join(tmpdir(), 'application-release-pg18-'));
const prismaDir = join(root, 'prisma');
const migrationDir = join(prismaDir, 'migrations');
mkdirSync(migrationDir, { recursive: true });
copyFileSync('server/prisma/schema.prisma', join(prismaDir, 'schema.prisma'));
copyFileSync('server/prisma/migrations/migration_lock.toml', join(migrationDir, 'migration_lock.toml'));
// Preserve the exact historical v2-to-v3 rehearsal before the new transition.
const bundle = buildPackage('a69f5fbc08c920c9146bda8a34454b51b5cc5eb8');
const files = verifyPackage(bundle);
const release = applicationReleaseSpec(files);
const names = bundle.files.flatMap((file) => {
  const match = file.path.match(/^server\/prisma\/migrations\/([^/]+)\/migration\.sql$/);
  return match ? [match[1]] : [];
}).sort();
assert.equal(names.length, 164);
assert.deepEqual(names.slice(161), Object.keys(release.requiredExactMigrations));
const add = (name) => {
  const directory = join(migrationDir, name);
  mkdirSync(directory);
  copyFileSync(`server/prisma/migrations/${name}/migration.sql`, join(directory, 'migration.sql'));
};
const deploy = () => execFileSync(process.execPath,
  [resolve('node_modules/prisma/build/index.js'), 'migrate', 'deploy', '--schema', join(prismaDir, 'schema.prisma')],
  { env: { ...process.env, PRISMA_HIDE_UPDATE_MESSAGE: 'true' }, stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 900000, maxBuffer: 8 * 1024 * 1024 });

try {
  const [{ version }] = await db.$queryRawUnsafe("SELECT current_setting('server_version_num')::int AS version");
  assert.equal(Math.floor(version / 10000), 18);
  for (const name of names.slice(0, 161)) add(name);
  deploy();
  const user = await db.$queryRawUnsafe(`INSERT INTO public."User" (username, "passwordHash", plan,
    "voicemailForwardEmail", "voicemailEmailForwardingEnabled")
    VALUES ('release_synthetic', 'unusable-synthetic-hash', 'PLUS', 'owner@example.test', true)
    RETURNING id`);
  const userId = user[0].id;
  const thread = await db.$queryRawUnsafe(`INSERT INTO public."SmsThread"
    ("userId", "updatedAt", "lastReadAt")
    VALUES ($1, now(), '2026-11-10 12:00:00') RETURNING id`, userId);
  const threadId = thread[0].id;
  const messages = await db.$queryRawUnsafe(`INSERT INTO public."SmsMessage"
    ("threadId", direction, "fromNumber", "toNumber", body, "createdAt")
    VALUES ($1, 'in', '+15551234567', '+15557654321', 'already seen',
      '2026-11-10 11:00:00'),
      ($1, 'in', '+15551234567', '+15557654321', 'later arrival',
      '2026-11-10 13:00:00') RETURNING id, body`, threadId);
  const voicemailId = 'twilio-REaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
  await db.$executeRawUnsafe(`INSERT INTO public."Voicemail"
    (id, "userId", "fromNumber", "toNumber", "audioUrl")
    VALUES ($1, $2, '+15551234567', '+15557654321',
      'https://api.twilio.com/synthetic.mp3')`, voicemailId, userId);
  const v2 = JSON.parse(files.get('server/security/staffMigrationReconciliation.v2.json'));
  for (const [name, pair] of Object.entries(v2.exceptions))
    await db.$executeRawUnsafe('UPDATE public._prisma_migrations SET checksum=$1 WHERE migration_name=$2',
      pair.recordedChecksum, name);
  for (const row of release.historicalRolledBackRows)
    await db.$executeRawUnsafe(`INSERT INTO public._prisma_migrations
      (id, checksum, migration_name, started_at, rolled_back_at, applied_steps_count)
      VALUES ($1, $2, $3, now(), now(), 0)`,
    row.id, row.checksum, row.name);
  const pending = Object.keys(release.requiredExactMigrations);
  const checks = checksForPending(files, pending);
  const before = await aggregateChecks(db, checks);
  assert.deepEqual((await runApplicationReleasePreflight(db, bundle, 'before',
    { allowProposedForIsolatedTest: true })).pending, pending);
  for (const name of pending) add(name);
  deploy();
  const after = await aggregateChecks(db, checks);
  assertChecks(checks, before, after);
  assert.equal((await runApplicationReleasePreflight(db, bundle, 'after',
    { allowProposedForIsolatedTest: true })).migrationCount, 164);
  const readRows = await db.$queryRawUnsafe(`SELECT body, "readAt" FROM public."SmsMessage"
    WHERE "threadId"=$1 ORDER BY "createdAt"`, threadId);
  assert.equal(readRows[0].readAt.toISOString(), '2026-11-10T12:00:00.000Z');
  assert.equal(readRows[1].readAt, null);
  const [zone] = await db.$queryRawUnsafe('SELECT "forwardQuietHoursTimeZone" AS zone FROM public."User" WHERE id=$1', userId);
  assert.equal(zone.zone, null, 'existing account must retain legacy zone fallback');
  const rolledBack = new Error('restricted-role-check-complete');
  await assert.rejects(db.$transaction(async (tx) => {
    await tx.$executeRawUnsafe('SET LOCAL ROLE chatforia_dev');
    await tx.user.update({ where: { id: userId }, data: { forwardQuietHoursTimeZone: 'America/Denver' } });
    await tx.smsMessage.update({ where: { id: messages[1].id }, data: { readAt: new Date() } });
    await tx.voicemailEmailDelivery.create({ data: {
      voicemailId, userId, recipient: 'owner@example.test',
    } });
    await tx.voicemailEmailDelivery.updateMany({ where: { voicemailId },
      data: { status: 'PROCESSING', attempts: { increment: 1 } } });
    await tx.voicemail.updateMany({ where: { id: voicemailId },
      data: { forwardedToEmailAt: new Date() } });
    throw rolledBack;
  }), (error) => error === rolledBack);
  assert.equal(await db.voicemailEmailDelivery.findUnique({ where: { voicemailId } }), null);
  await db.voicemailEmailDelivery.create({ data: {
    voicemailId, userId, recipient: 'owner@example.test', nextAttemptAt: new Date(0),
  } });
  let sends = 0;
  const send = async () => { sends += 1; return true; };
  await Promise.all([dispatchVoicemailEmailOnce({ db, send }),
    dispatchVoicemailEmailOnce({ db, send })]);
  assert.equal(sends, 1);
  assert.equal((await db.voicemailEmailDelivery.findUnique({ where: { voicemailId } })).status, 'SENT');
  // Keep the approved 165 recovery package exact even when a later review
  // branch proposes migration 166.
  const nextBundle = buildPackage('aa4b4e040464336033ed8f9679290e727d58e7a6');
  const nextFiles = verifyPackage(nextBundle);
  const next = applicationReleaseSpec(nextFiles);
  // Reproduce the actual failing managed-admin migration, then invoke the
  // production recovery runner's programmatic loopback-only test entrypoint.
  await db.$executeRawUnsafe("CREATE ROLE doadmin LOGIN CREATEROLE PASSWORD 'synthetic_recovery_only'");
  await db.$executeRawUnsafe("DO $$ BEGIN IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='postgres') THEN CREATE ROLE postgres NOLOGIN CREATEROLE; END IF; END $$");
  await db.$executeRawUnsafe('GRANT chatforia_staff_owner TO postgres WITH ADMIN TRUE');
  await db.$executeRawUnsafe('GRANT CONNECT ON DATABASE chatforia_application_release_test TO doadmin');
  await db.$executeRawUnsafe('GRANT USAGE ON SCHEMA public TO doadmin');
  await db.$executeRawUnsafe('GRANT SELECT ON ALL TABLES IN SCHEMA public TO doadmin');
  await db.$executeRawUnsafe('GRANT INSERT, UPDATE ON public._prisma_migrations TO doadmin');
  await db.$transaction(async tx=>{
    await tx.$executeRawUnsafe('SET LOCAL ROLE postgres');
    await tx.$executeRawUnsafe('GRANT chatforia_staff_owner TO doadmin WITH ADMIN TRUE, INHERIT FALSE, SET FALSE');
  });
  const operatorUrl=new URL(url); operatorUrl.username='doadmin'; operatorUrl.password='synthetic_recovery_only';
  const operator=new PrismaClient({datasources:{db:{url:operatorUrl.toString()}}});
  try {
    await operator.$executeRawUnsafe('GRANT chatforia_staff_owner TO doadmin WITH ADMIN FALSE, INHERIT FALSE, SET TRUE');
    await checkRecoveryRole(operator,false,'chatforia_application_release_test');
    add(failedAttempt.name);
    assert.throws(()=>execFileSync(process.execPath,[resolve('node_modules/prisma/build/index.js'),
      'migrate','deploy','--schema',join(prismaDir,'schema.prisma')],{
        env:{...process.env,DATABASE_URL:operatorUrl.toString()},stdio:'pipe',timeout:60000}));
    const [failed]=await operator.$queryRawUnsafe(`SELECT id,logs,applied_steps_count FROM public._prisma_migrations
      WHERE migration_name=$1 AND finished_at IS NULL AND rolled_back_at IS NULL`,failedAttempt.name);
    assert.match(failed.logs,/permission denied for schema staff_security/);
    assert.equal(failed.applied_steps_count,0);
    // Only the disposable fixture normalizes the random failed ID to the pinned
    // production incident ID; production recovery never updates ledger rows itself.
    await db.$executeRawUnsafe('UPDATE public._prisma_migrations SET id=$1 WHERE id=$2',failedAttempt.id,failed.id);
  } finally { await operator.$disconnect(); }
  const packagePath=join(root,'recovery-package.json');
  const bytes=Buffer.from(JSON.stringify(nextBundle,null,2)+'\n'); writeFileSync(packagePath,bytes);
  const archive=join(root,'receipts'); mkdirSync(archive);
  const failureStage=process.env.MFA_RECOVERY_FAILURE || 'none';
  assert.ok(['none','after-resolve','during-deploy'].includes(failureStage));
  process.env.DATABASE_URL=operatorUrl.toString();
  const options={package:packagePath,sha256:digest(bytes),archive,execute:true};
  const testOptions={allowSyntheticForTest:true,...(failureStage==='none'?{}:{failureStage})};
  try {
    if (failureStage==='none') await recover(options,testOptions);
    else await assert.rejects(recover(options,testOptions),/Recovery stopped/);
    const check=new PrismaClient({datasources:{db:{url:operatorUrl.toString()}}});
    try {
      await checkRecoveryRole(check,false,'chatforia_application_release_test');
      const rows=await check.$queryRawUnsafe(`SELECT finished_at,rolled_back_at FROM public._prisma_migrations WHERE id=$1`,failedAttempt.id);
      assert.equal(rows[0].finished_at,null); assert.ok(rows[0].rolled_back_at);
      const [done]=await check.$queryRawUnsafe(`SELECT count(*)::int AS n FROM public._prisma_migrations
        WHERE migration_name=$1 AND finished_at IS NOT NULL AND rolled_back_at IS NULL`,failedAttempt.name);
      assert.equal(done.n,failureStage==='none'?1:0);
    } finally {await check.$disconnect();}
    const receiptFiles=readdirSync(archive).flatMap(dir=>readdirSync(join(archive,dir)).map(file=>join(archive,dir,file)));
    assert.ok(receiptFiles.some(p=>p.endsWith('inherit-disabled.json')));
    for(const file of receiptFiles) assert.ok(!readFileSync(file,'utf8').includes('synthetic_recovery_only'));
    console.log(`PASS: actual MFA recovery runner / real Prisma resolve+deploy / cleanup / ${failureStage}`);
  } finally {process.env.DATABASE_URL=url.toString();}
  if (failureStage === 'none') {
    const esimBundle = buildPackage('HEAD');
    const esimFiles = verifyPackage(esimBundle);
    const esimRelease = applicationReleaseSpec(esimFiles);
    assert.equal(esimRelease.status, 'proposed-not-authorized-for-production');
    assert.equal(esimRelease.beforeCount, 165);
    assert.equal(esimRelease.afterCount, 166);
    const [esimName] = Object.keys(esimRelease.requiredExactMigrations);
    assert.equal(esimName, '20261113010000_add_esim_operation_lock');
    const fixture = await db.mobileDataPackPurchase.create({ data: {
      userId, kind: 'ESIM', addonKind: 'chatforia_esim_local_3_premium',
      totalDataMb: 3072, remainingDataMb: 2048,
      expiresAt: new Date('2026-12-01T00:00:00Z'),
      billingTransactionId: 'synthetic-esim-166-paid',
    } });
    const checks = checksForPending(esimFiles, [esimName]);
    const before = await aggregateChecks(db, checks);
    assert.deepEqual((await runApplicationReleasePreflight(db, esimBundle, 'before',
      { allowProposedForIsolatedTest: true })).pending, [esimName]);
    add(esimName);
    deploy();
    const after = await aggregateChecks(db, checks);
    assertChecks(checks, before, after);
    assert.equal((await runApplicationReleasePreflight(db, esimBundle, 'after',
      { allowProposedForIsolatedTest: true })).migrationCount, 166);
    assert.deepEqual(await db.mobileDataPackPurchase.findUnique({ where: { id: fixture.id } }), fixture);
    await db.$transaction(async (tx) => {
      await tx.$executeRawUnsafe('SET LOCAL ROLE chatforia_dev');
      await tx.$executeRawUnsafe(`INSERT INTO public."EsimOperationLock"
        ("userId", token, operation) VALUES (987654321, 'synthetic-166-lock', 'PURCHASE')`);
      await tx.$executeRawUnsafe(`DELETE FROM public."EsimOperationLock"
        WHERE "userId" = 987654321`);
    });
    console.log('PASS: disposable PG18 approved 165 recovery then proposed 166 migration, preserved eSIM entitlement and restricted lock writes');
  }
  console.log('PASS: disposable PG18 v2-to-v3 161/4/0 to 164/4/0 history, exact recovery rows, SMS backfill, NULL zone, restricted grants, atomic outbox claim and aggregate preservation');
} finally {
  await db.$disconnect();
  rmSync(root, { recursive: true, force: true });
}
