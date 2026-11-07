import assert from 'node:assert/strict';
import { readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { PrismaClient } from '@prisma/client';

import { artifacts, freshCluster } from './staff-fresh-postgres.mjs';
import { recordTwilioConsentAction } from '../services/twilioConsent.js';

let cluster;
let db;
try {
  cluster = await freshCluster('source');
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

  cluster.sql(database, `
    CREATE FUNCTION reject_synthetic_optout() RETURNS trigger AS $$
    BEGIN
      IF NEW."inboundMessageId" = 'SM-storage-fail' THEN
        RAISE EXCEPTION 'synthetic opt-out storage failure';
      END IF;
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;
    CREATE TRIGGER reject_synthetic_optout BEFORE INSERT OR UPDATE ON "SmsOptOut"
      FOR EACH ROW EXECUTE FUNCTION reject_synthetic_optout();
  `);
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
  if (JSON.parse(readFileSync(join(artifacts, 'synthetic-only.json'), 'utf8')).pid === process.pid) {
    rmSync(artifacts, { recursive: true, force: true });
  }
}
