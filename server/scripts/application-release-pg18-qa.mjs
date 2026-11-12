import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, copyFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { PrismaClient } from '@prisma/client';
import { applicationReleaseSpec, buildPackage, checksForPending, verifyPackage } from './migration-package.mjs';
import { aggregateChecks, assertChecks } from './deploy-migration-package.mjs';
import { runApplicationReleasePreflight } from './application-release-preflight.mjs';
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
const bundle = buildPackage('HEAD');
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
  const thread = await db.$queryRawUnsafe(`INSERT INTO public."SmsThread" ("userId", "lastReadAt")
    VALUES ($1, '2026-11-10 12:00:00') RETURNING id`, userId);
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
  for (let i = 0; i < 3; i++)
    await db.$executeRawUnsafe(`INSERT INTO public._prisma_migrations
      (id, checksum, migration_name, started_at, rolled_back_at, applied_steps_count)
      VALUES ($1, $2, $3, now(), now(), 0)`,
    `00000000-0000-0000-0000-${String(i + 301).padStart(12, '0')}`,
    'e'.repeat(64), names[i]);
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
  console.log('PASS: disposable PG18 v2-to-v3 161/164 history, three checksums, SMS backfill, NULL zone, restricted grants, atomic outbox claim and aggregate preservation');
} finally {
  await db.$disconnect();
  rmSync(root, { recursive: true, force: true });
}
