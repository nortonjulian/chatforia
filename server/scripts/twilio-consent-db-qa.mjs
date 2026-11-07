import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { PrismaClient } from '@prisma/client';

import { recordTwilioConsentAction } from '../services/twilioConsent.js';

let cluster;
let db;
let artifacts;
try {
  if (process.env.CONSENT_QA_CI_SERVICE === '1') {
    const expectedUrl = 'postgresql://consent_ci:synthetic_ci_only@127.0.0.1:5432/chatforia_twilio_consent_test';
    assert.equal(process.env.GITHUB_ACTIONS, 'true');
    assert.equal(process.env.DATABASE_URL, expectedUrl);
    db = new PrismaClient({ datasources: { db: { url: expectedUrl } } });

    const [identity] = await db.$queryRaw`
      SELECT current_database() AS database, current_user AS db_role`;
    assert.deepEqual(identity, {
      database: 'chatforia_twilio_consent_test', db_role: 'consent_ci',
    });
    const migrationSql = readFileSync(
      'server/prisma/migrations/20261106010000_twilio_compliance_event_sid/migration.sql'
    );
    const checksum = createHash('sha256').update(migrationSql).digest('hex');
    const migrations = await db.$queryRaw`
      SELECT checksum, finished_at, rolled_back_at
      FROM public._prisma_migrations
      WHERE migration_name = '20261106010000_twilio_compliance_event_sid'`;
    assert.equal(migrations.length, 1);
    assert.equal(migrations[0].checksum, checksum);
    assert.ok(migrations[0].finished_at);
    assert.equal(migrations[0].rolled_back_at, null);

    const [column] = await db.$queryRaw`
      SELECT data_type, character_maximum_length, is_nullable
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'SmsCarrierEvent'
        AND column_name = 'providerMessageId'`;
    assert.deepEqual(column, {
      data_type: 'character varying', character_maximum_length: 128,
      is_nullable: 'YES',
    });
    const [role] = await db.$queryRaw`
      SELECT rolsuper, rolcreatedb, rolcreaterole, rolbypassrls
      FROM pg_roles WHERE rolname = 'chatforia_dev'`;
    assert.deepEqual(role, {
      rolsuper: false, rolcreatedb: false,
      rolcreaterole: false, rolbypassrls: false,
    });
    const [grants] = await db.$queryRaw`
      SELECT
        has_schema_privilege('chatforia_dev', 'public', 'USAGE') AS schema_usage,
        has_table_privilege('chatforia_dev', 'public."SmsCarrierEvent"', 'SELECT') AS event_select,
        has_table_privilege('chatforia_dev', 'public."SmsCarrierEvent"', 'INSERT') AS event_insert,
        has_table_privilege('chatforia_dev', 'public."SmsCarrierEvent"', 'UPDATE') AS event_update,
        has_table_privilege('chatforia_dev', 'public."SmsCarrierEvent"', 'DELETE') AS event_delete,
        has_table_privilege('chatforia_dev', 'public."SmsOptOut"', 'SELECT') AS optout_select,
        has_table_privilege('chatforia_dev', 'public."SmsOptOut"', 'INSERT') AS optout_insert,
        has_table_privilege('chatforia_dev', 'public."SmsOptOut"', 'UPDATE') AS optout_update,
        has_table_privilege('chatforia_dev', 'public."SmsOptOut"', 'DELETE') AS optout_delete,
        has_sequence_privilege('chatforia_dev', 'public."SmsCarrierEvent_id_seq"', 'USAGE') AS event_seq_usage,
        has_sequence_privilege('chatforia_dev', 'public."SmsCarrierEvent_id_seq"', 'SELECT') AS event_seq_select,
        has_sequence_privilege('chatforia_dev', 'public."SmsOptOut_id_seq"', 'USAGE') AS optout_seq_usage,
        has_sequence_privilege('chatforia_dev', 'public."SmsOptOut_id_seq"', 'SELECT') AS optout_seq_select`;
    assert.ok(Object.values(grants).every(Boolean), 'restricted runtime privileges missing');

    // Exercise actual inserts, reads, updates and deletes under the restricted
    // role, then roll back the synthetic probe before the consent cases.
    const rollback = new Error('permission probe rollback');
    await assert.rejects(db.$transaction(async (tx) => {
      await tx.$executeRawUnsafe('SET LOCAL ROLE chatforia_dev');
      const event = await tx.smsCarrierEvent.create({
        data: {
          providerMessageId: 'SM-permission-probe', from: '+15550005555',
          to: '+15550002222', body: 'STOP', direction: 'inbound',
        },
      });
      await tx.smsCarrierEvent.findUnique({ where: { id: event.id } });
      await tx.smsCarrierEvent.update({
        where: { id: event.id }, data: { action: 'opt_out' },
      });
      await tx.smsCarrierEvent.delete({ where: { id: event.id } });
      const optout = await tx.smsOptOut.create({
        data: { phone: '+15550005555', provider: 'twilio' },
      });
      await tx.smsOptOut.findUnique({ where: { id: optout.id } });
      await tx.smsOptOut.update({
        where: { id: optout.id }, data: { reason: 'STOP' },
      });
      await tx.smsOptOut.delete({ where: { id: optout.id } });
      throw rollback;
    }), (error) => error === rollback);
    assert.equal(await db.smsCarrierEvent.count(), 0);
    assert.equal(await db.smsOptOut.count(), 0);
  } else {
    const helper = await import('./staff-fresh-postgres.mjs');
    artifacts = helper.artifacts;
    cluster = await helper.freshCluster('source');
    cluster.sql('postgres', 'CREATE DATABASE twilio_consent_test;');
    const database = 'twilio_consent_test';
    cluster.sql(database, `
    CREATE TABLE "SmsCarrierEvent" (
      "id" SERIAL PRIMARY KEY, "from" TEXT NOT NULL, "to" TEXT NOT NULL,
      "body" TEXT NOT NULL, "direction" TEXT NOT NULL, "action" TEXT,
      "metadata" JSONB, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE "SmsOptOut" (
      "id" SERIAL PRIMARY KEY, "phone" TEXT NOT NULL, "provider" TEXT,
      "reason" TEXT, "inboundMessageId" TEXT, "rawPayload" JSONB,
      "ipAddress" TEXT, "userAgent" TEXT,
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE UNIQUE INDEX "SmsOptOut_phone_provider_key"
      ON "SmsOptOut"("phone", "provider");
  `);
    cluster.sql(database, readFileSync(
      'server/prisma/migrations/20261106010000_twilio_compliance_event_sid/migration.sql',
      'utf8'
    ));
    db = new PrismaClient({ datasources: { db: { url: cluster.url(database) } } });
  }

  const from = '+15550001111';
  const input = (action, messageSid, phone = from) => ({
    action, messageSid, phone, to: '+15550002222', body: action,
    reason: action, rawPayload: { MessageSid: messageSid },
    ipAddress: null, userAgent: null,
  });
  const apply = (action, sid, phone) =>
    recordTwilioConsentAction(db, input(action, sid, phone));
  const optOut = (phone = from) => db.smsOptOut.findFirst({ where: { phone } });
  const receipts = () => db.smsCarrierEvent.count();

  assert.deepEqual(await apply('STOP', 'SM-first'), { duplicate: false });
  assert.deepEqual(await apply('STOP', 'SM-first'), { duplicate: true });
  assert.equal((await optOut()).inboundMessageId, 'SM-first');
  assert.equal(await receipts(), 1);

  const concurrentPhone = '+15550003333';
  const retries = await Promise.all(Array.from({ length: 6 }, () =>
    apply('STOP', 'SM-concurrent', concurrentPhone)
  ));
  assert.equal(retries.filter(({ duplicate }) => !duplicate).length, 1);
  assert.equal(retries.filter(({ duplicate }) => duplicate).length, 5);
  assert.equal((await optOut(concurrentPhone)).inboundMessageId, 'SM-concurrent');
  assert.equal(await receipts(), 2);

  assert.deepEqual(await apply('START', 'SM-start'), { duplicate: false });
  assert.equal(await optOut(), null);
  assert.deepEqual(await apply('STOP', 'SM-first'), { duplicate: true });
  assert.equal(await optOut(), null);
  assert.deepEqual(await apply('STOP', 'SM-new-stop'), { duplicate: false });
  assert.equal((await optOut()).inboundMessageId, 'SM-new-stop');
  assert.equal(await receipts(), 4);

  const rejectFunctionSql = `
    CREATE FUNCTION reject_synthetic_optout() RETURNS trigger AS $$
    BEGIN
      IF NEW."inboundMessageId" = 'SM-storage-fail' THEN
        RAISE EXCEPTION 'synthetic opt-out storage failure';
      END IF;
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql`;
  const rejectTriggerSql = `
    CREATE TRIGGER reject_synthetic_optout BEFORE INSERT OR UPDATE ON "SmsOptOut"
      FOR EACH ROW EXECUTE FUNCTION reject_synthetic_optout()`;
  if (cluster) {
    cluster.sql('twilio_consent_test', `${rejectFunctionSql}; ${rejectTriggerSql};`);
  } else {
    await db.$executeRawUnsafe(rejectFunctionSql);
    await db.$executeRawUnsafe(rejectTriggerSql);
  }
  const failedPhone = '+15550004444';
  await assert.rejects(apply('STOP', 'SM-storage-fail', failedPhone));
  assert.equal(await optOut(failedPhone), null);
  assert.equal(await db.smsCarrierEvent.findUnique({
    where: { providerMessageId: 'SM-storage-fail' },
  }), null);
  assert.equal(await receipts(), 4);

  console.log('PASS: migration, duplicate, concurrent retries, STOP/START replay, new STOP, rollback');
} finally {
  if (db) await db.$disconnect();
  if (cluster) cluster.stop();
  // Only this process's fresh-cluster helper can create this marked directory.
  if (artifacts &&
      JSON.parse(readFileSync(join(artifacts, 'synthetic-only.json'), 'utf8')).pid === process.pid) {
    rmSync(artifacts, { recursive: true, force: true });
  }
}
