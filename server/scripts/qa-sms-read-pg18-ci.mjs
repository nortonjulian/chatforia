import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { buildPackage, verifyPackage, applicationReleaseSpec, checkHistory } from './migration-package.mjs';
import { PrismaClient } from '@prisma/client';

const expectedUrl = 'postgresql://chatforia:qa_password@127.0.0.1:5432/chatforia_room_settings_test';
assert.equal(process.env.GITHUB_ACTIONS, 'true');
assert.equal(process.env.DATABASE_URL, expectedUrl);
assert.match(process.env.CI_POSTGRES18_CONTAINER || '', /^[a-f0-9]{12,64}$/);

const migrationName = '20261109010000_sms_message_read_receipts';
const migrationSql = readFileSync(`server/prisma/migrations/${migrationName}/migration.sql`, 'utf8');
const checksum = createHash('sha256').update(migrationSql).digest('hex');
const quietMigrationName = '20261110010000_forwarding_quiet_hours_time_zone';
const quietMigrationSql = readFileSync(`server/prisma/migrations/${quietMigrationName}/migration.sql`, 'utf8');
const quietChecksum = createHash('sha256').update(quietMigrationSql).digest('hex');
const db = new PrismaClient({ datasources: { db: { url: expectedUrl } } });

try {
  const [identity] = await db.$queryRaw`
    SELECT current_database() AS database, current_user AS role,
           current_setting('server_version_num')::integer AS version`;
  assert.deepEqual(identity, {
    database: 'chatforia_room_settings_test', role: 'chatforia', version: 180006,
  });

  const rows = await db.$queryRaw`
    SELECT migration_name, checksum, finished_at, rolled_back_at
    FROM public._prisma_migrations`;
  const combinedManifestPath = 'server/security/applicationMigrationRelease.v3.json';
  if (existsSync(combinedManifestPath)) {
    const combined = JSON.parse(readFileSync(combinedManifestPath, 'utf8'));
    assert.equal(combined.afterCount, 164);
    const bundle = buildPackage('HEAD');
    const release = applicationReleaseSpec(verifyPackage(bundle));
    assert.equal(rows.length, release.afterCount);
    assert.deepEqual(checkHistory(bundle, rows, true), []);
    for (const [name, expectedChecksum] of Object.entries(combined.requiredExactMigrations)) {
      const applied = rows.filter((row) => row.migration_name === name);
      assert.equal(applied.length, 1);
      assert.equal(applied[0].checksum, expectedChecksum);
    }
  } else {
    assert.equal(rows.length, 163);
  }
  assert.ok(rows.every((row) => row.finished_at && !row.rolled_back_at));
  for (const [name, expectedChecksum] of [[migrationName, checksum], [quietMigrationName, quietChecksum]]) {
    const applied = rows.filter((row) => row.migration_name === name);
    assert.equal(applied.length, 1);
    assert.equal(applied[0].checksum, expectedChecksum);
  }

  const [column] = await db.$queryRaw`
    SELECT data_type, is_nullable FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'SmsMessage'
      AND column_name = 'readAt'`;
  assert.deepEqual(column, { data_type: 'timestamp without time zone', is_nullable: 'YES' });
  const [index] = await db.$queryRaw`
    SELECT indexdef FROM pg_indexes WHERE schemaname = 'public'
      AND tablename = 'SmsMessage'
      AND indexname = 'SmsMessage_threadId_direction_readAt_idx'`;
  assert.match(index.indexdef, /"threadId", direction, "readAt"/);

  const [quietColumn] = await db.$queryRaw`
    SELECT data_type, character_maximum_length, is_nullable
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'User'
      AND column_name = 'forwardQuietHoursTimeZone'`;
  assert.deepEqual(quietColumn, {
    data_type: 'character varying', character_maximum_length: 64, is_nullable: 'YES',
  });

  const [privileges] = await db.$queryRaw`
    SELECT
      has_schema_privilege('chatforia_dev', 'public', 'USAGE') AS schema_usage,
      has_table_privilege('chatforia_dev', 'public."SmsMessage"', 'SELECT') AS message_select,
      has_table_privilege('chatforia_dev', 'public."SmsMessage"', 'INSERT') AS message_insert,
      has_table_privilege('chatforia_dev', 'public."SmsMessage"', 'UPDATE') AS message_update,
      has_column_privilege('chatforia_dev', 'public."SmsMessage"', 'readAt', 'UPDATE') AS receipt_update,
      has_table_privilege('chatforia_dev', 'public."SmsThread"', 'SELECT') AS thread_select,
      has_sequence_privilege('chatforia_dev', 'public."SmsMessage_id_seq"', 'USAGE') AS sequence_usage,
      has_table_privilege('chatforia_dev', 'public."StaffAssignment"', 'UPDATE') AS protected_update,
      has_table_privilege('chatforia_dev', 'public."User"', 'SELECT') AS user_select,
      has_column_privilege('chatforia_dev', 'public."User"', 'forwardQuietHoursTimeZone', 'UPDATE') AS zone_update,
      has_column_privilege('chatforia_dev', 'public."User"', 'role', 'UPDATE') AS role_update`;
  assert.ok(Object.entries(privileges).every(([key, value]) =>
    ['protected_update', 'role_update'].includes(key) ? value === false : value === true));

  // Reapply the exact SQL against a minimal legacy fixture in a separate
  // schema. Every fixture change is rolled back, and public stays untouched.
  const fixtureSql = [
    'BEGIN;',
    'CREATE SCHEMA sms_read_legacy_fixture;',
    'SET LOCAL search_path = sms_read_legacy_fixture, public;',
    readFileSync('server/scripts/qa-sms-read-migration-setup.sql', 'utf8'),
    migrationSql,
    readFileSync('server/scripts/qa-sms-read-migration-assertions.sql', 'utf8'),
    'ROLLBACK;',
  ].join('\n');
  execFileSync('docker', [
    'exec', '-i', process.env.CI_POSTGRES18_CONTAINER,
    'psql', '-X', '-v', 'ON_ERROR_STOP=1', '-U', 'chatforia',
    '-d', 'chatforia_room_settings_test',
  ], { input: fixtureSql, stdio: ['pipe', 'pipe', 'pipe'] });

  const rolledBack = new Error('synthetic SMS read QA rollback');
  await assert.rejects(db.$transaction(async (tx) => {
    const owner = await tx.user.create({ data: { username: 'sms_read_owner', passwordHash: 'synthetic' } });
    const other = await tx.user.create({ data: { username: 'sms_read_other', passwordHash: 'synthetic' } });
    const thread = await tx.smsThread.create({ data: { userId: owner.id } });
    const otherThread = await tx.smsThread.create({ data: { userId: other.id } });
    const [reserved] = await tx.$queryRaw`SELECT nextval('public."SmsMessage_id_seq"')::integer AS id`;
    const at = new Date('2026-11-09T12:00:00.000Z');
    const data = { direction: 'in', fromNumber: '+15550001111',
      toNumber: '+15550002222', body: 'synthetic', createdAt: at };
    const first = await tx.smsMessage.create({ data: { ...data, threadId: thread.id } });
    const second = await tx.smsMessage.create({ data: { ...data, threadId: thread.id } });
    const foreign = await tx.smsMessage.create({ data: { ...data, threadId: otherThread.id } });

    await tx.$executeRawUnsafe('SET LOCAL ROLE chatforia_dev');
    const owned = (ids) => ({ id: { in: ids }, threadId: thread.id, direction: 'in',
      thread: { userId: owner.id, archivedAt: null, deletedAt: null } });
    const mixed = await tx.smsMessage.findMany({ where: owned([first.id, foreign.id]), select: { id: true } });
    assert.equal(mixed.length, 1, 'foreign ID must fail all-ID route validation');

    // Simulate arrivals after the rendered IDs were captured, including an
    // earlier reserved ID and an identical creation timestamp.
    const lower = await tx.smsMessage.create({ data: { ...data, id: reserved.id, threadId: thread.id } });
    const later = await tx.smsMessage.create({ data: { ...data, threadId: thread.id } });
    const updated = await tx.smsMessage.updateMany({
      where: { ...owned([first.id, second.id]), readAt: null }, data: { readAt: new Date() },
    });
    assert.equal(updated.count, 2);
    const retry = await tx.smsMessage.updateMany({
      where: { ...owned([second.id, first.id]), readAt: null }, data: { readAt: new Date() },
    });
    assert.equal(retry.count, 0);
    const unread = await tx.smsMessage.findMany({
      where: { threadId: thread.id, direction: 'in', readAt: null }, select: { id: true },
    });
    assert.deepEqual(new Set(unread.map(({ id }) => id)), new Set([lower.id, later.id]));
    assert.equal((await tx.smsMessage.findUnique({ where: { id: foreign.id } })).readAt, null);
    throw rolledBack;
  }, { timeout: 15000 }), (error) => error === rolledBack);
  assert.equal(await db.user.count({ where: { username: { startsWith: 'sms_read_' } } }), 0);

  const quietRollback = new Error('synthetic quiet-hours QA rollback');
  await assert.rejects(db.$transaction(async (tx) => {
    const legacy = await tx.user.create({ data: {
      username: 'quiet_legacy', passwordHash: 'synthetic',
      forwardQuietHoursStart: 22, forwardQuietHoursEnd: 6,
    } });
    const selected = await tx.user.create({ data: {
      username: 'quiet_selected', passwordHash: 'synthetic',
      forwardQuietHoursStart: 22, forwardQuietHoursEnd: 6,
    } });
    await tx.$executeRawUnsafe('SET LOCAL ROLE chatforia_dev');
    const read = { forwardQuietHoursStart: true, forwardQuietHoursEnd: true,
      forwardQuietHoursTimeZone: true };
    assert.deepEqual(await tx.user.findUnique({ where: { id: legacy.id }, select: read }), {
      forwardQuietHoursStart: 22, forwardQuietHoursEnd: 6, forwardQuietHoursTimeZone: null,
    });
    const unchanged = await tx.user.update({ where: { id: legacy.id },
      data: { forwardQuietHoursStart: 21 }, select: read });
    assert.deepEqual(unchanged, {
      forwardQuietHoursStart: 21, forwardQuietHoursEnd: 6, forwardQuietHoursTimeZone: null,
    });
    const saved = await tx.user.update({ where: { id: selected.id },
      data: { forwardQuietHoursTimeZone: 'America/Denver' }, select: read });
    assert.deepEqual(saved, {
      forwardQuietHoursStart: 22, forwardQuietHoursEnd: 6,
      forwardQuietHoursTimeZone: 'America/Denver',
    });
    assert.equal((await tx.user.findUnique({ where: { id: selected.id }, select: read }))
      .forwardQuietHoursTimeZone, 'America/Denver');
    throw quietRollback;
  }, { timeout: 15000 }), (error) => error === quietRollback);
  assert.equal(await db.user.count({ where: { username: { startsWith: 'quiet_' } } }), 0);

  console.log('PASS: PostgreSQL 18.6 SMS/quiet-hours migrations, SMS legacy backfill and exact reads, quiet-hours save/read and legacy NULL, restricted runtime grants');
} finally {
  await db.$disconnect();
}
