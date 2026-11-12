import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

import { PrismaClient } from '@prisma/client';

import { dispatchVoicemailEmailOnce } from '../jobs/voicemailEmailDispatcher.js';

const migrationName = '20261111010000_voicemail_email_delivery_outbox';
const url = new URL(process.env.DATABASE_URL || 'postgresql://invalid/invalid');
assert.equal(process.env.VOICEMAIL_QA_CI_SERVICE, '1');
assert.equal(url.hostname, '127.0.0.1');
assert.equal(url.pathname, '/chatforia_voicemail_test');
const db = new PrismaClient();

const makeVoicemail = async (id, userId) => db.voicemail.create({
  data: {
    id, userId, fromNumber: '+15551234567', toNumber: '+15557654321',
    audioUrl: `https://api.twilio.com/synthetic/${id}.mp3`, durationSec: 12,
  },
});
const makeDelivery = async (id, userId) => db.voicemailEmailDelivery.create({
  data: { voicemailId: id, userId, recipient: 'owner@example.test', nextAttemptAt: new Date(0) },
});

try {
  const [{ version }] = await db.$queryRawUnsafe('SELECT current_setting(\'server_version_num\')::int AS version');
  assert.equal(Math.floor(version / 10000), 18);
  const sql = await readFile(new URL(`../prisma/migrations/${migrationName}/migration.sql`, import.meta.url));
  const checksum = createHash('sha256').update(sql).digest('hex');
  const migrations = await db.$queryRawUnsafe('SELECT migration_name, checksum, finished_at, rolled_back_at FROM public._prisma_migrations WHERE migration_name = $1', migrationName);
  assert.equal(migrations.length, 1);
  assert.equal(migrations[0].checksum, checksum);
  assert.ok(migrations[0].finished_at);
  assert.equal(migrations[0].rolled_back_at, null);

  const user = await db.user.create({ data: {
    username: 'voicemail_qa_owner', passwordHash: 'synthetic-not-a-password', plan: 'PLUS',
    voicemailForwardEmail: 'owner@example.test', voicemailEmailForwardingEnabled: true,
  } });
  const base = 'twilio-REbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
  await makeVoicemail(base, user.id);
  await makeDelivery(base, user.id);
  let sends = 0;
  const send = async () => { sends += 1; await new Promise((resolve) => setTimeout(resolve, 20)); return true; };
  await Promise.all([
    dispatchVoicemailEmailOnce({ db, send }),
    dispatchVoicemailEmailOnce({ db, send }),
  ]);
  assert.equal(sends, 1, 'concurrent workers must claim once');
  assert.equal((await db.voicemailEmailDelivery.findUnique({ where: { voicemailId: base } })).status, 'SENT');
  assert.ok((await db.voicemail.findUnique({ where: { id: base } })).forwardedToEmailAt);

  const restarted = 'twilio-REcccccccccccccccccccccccccccccccc';
  await makeVoicemail(restarted, user.id);
  await makeDelivery(restarted, user.id);
  await db.voicemailEmailDelivery.update({ where: { voicemailId: restarted }, data: {
    status: 'PROCESSING', attempts: 1, leaseId: 'stopped-process', leaseUntil: new Date(0),
  } });
  await dispatchVoicemailEmailOnce({ db, send: async () => true });
  assert.equal((await db.voicemailEmailDelivery.findUnique({ where: { voicemailId: restarted } })).status, 'SENT');

  const failed = 'twilio-REdddddddddddddddddddddddddddddddd';
  await makeVoicemail(failed, user.id);
  await makeDelivery(failed, user.id);
  let failureClock = new Date(Date.now());
  for (let attempt = 0; attempt < 5; attempt += 1) {
    await dispatchVoicemailEmailOnce({ db, now: () => failureClock, send: async () => false });
    assert.equal((await db.voicemailEmailDelivery.findUnique({ where: { voicemailId: failed } })).attempts, attempt + 1);
    failureClock = new Date(failureClock.getTime() + 2 * 60 * 60 * 1000);
  }
  const exhausted = await db.voicemailEmailDelivery.findUnique({ where: { voicemailId: failed } });
  assert.equal(exhausted.status, 'FAILED');
  assert.equal(exhausted.attempts, 5);

  const stoppedFinal = 'twilio-REabababababababababababababababab';
  await makeVoicemail(stoppedFinal, user.id);
  await makeDelivery(stoppedFinal, user.id);
  await db.voicemailEmailDelivery.update({ where: { voicemailId: stoppedFinal }, data: {
    status: 'PROCESSING', attempts: 5, leaseId: 'stopped-final-worker', leaseUntil: new Date(0),
  } });
  await dispatchVoicemailEmailOnce({ db, send: async () => { throw new Error('unexpected extra send'); } });
  const finalResult = await db.voicemailEmailDelivery.findUnique({ where: { voicemailId: stoppedFinal } });
  assert.equal(finalResult.status, 'FAILED');
  assert.equal(finalResult.lastError, 'final_attempt_result_unknown');

  const rollbackId = 'twilio-REeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee';
  await assert.rejects(db.$transaction(async (tx) => {
    await tx.voicemail.create({ data: {
      id: rollbackId, userId: user.id, fromNumber: '+15551234567',
      toNumber: '+15557654321', audioUrl: 'https://api.twilio.com/synthetic/rollback.mp3',
    } });
    await tx.voicemailEmailDelivery.create({ data: {
      voicemailId: 'nonexistent-recording', userId: user.id, recipient: 'owner@example.test',
    } });
  }));
  assert.equal(await db.voicemail.findUnique({ where: { id: rollbackId } }), null);

  const restrictedId = 'twilio-REffffffffffffffffffffffffffffffff';
  await makeVoicemail(restrictedId, user.id);
  const rolledBack = new Error('restricted-role-check-complete');
  await assert.rejects(db.$transaction(async (tx) => {
    await tx.$executeRawUnsafe('SET LOCAL ROLE chatforia_dev');
    const [permissions] = await tx.$queryRawUnsafe(`SELECT
      has_table_privilege(current_user, 'public."VoicemailEmailDelivery"', 'SELECT') AS can_read,
      has_table_privilege(current_user, 'public."VoicemailEmailDelivery"', 'INSERT') AS can_insert,
      has_table_privilege(current_user, 'public."VoicemailEmailDelivery"', 'UPDATE') AS can_update,
      has_table_privilege(current_user, 'public."VoicemailEmailDelivery"', 'DELETE') AS can_delete,
      has_column_privilege(current_user, 'public."Voicemail"', 'forwardedToEmailAt', 'UPDATE') AS can_mark_sent,
      has_table_privilege(current_user, 'public."StaffAssignment"', 'UPDATE') AS can_write_staff`);
    assert.deepEqual(permissions, {
      can_read: true, can_insert: true, can_update: true,
      can_delete: false, can_mark_sent: true, can_write_staff: false,
    });
    assert.ok(await tx.user.findUnique({ where: { id: user.id }, select: { voicemailForwardEmail: true } }));
    await tx.voicemailEmailDelivery.create({ data: {
      voicemailId: restrictedId, userId: user.id, recipient: 'owner@example.test',
    } });
    await tx.voicemailEmailDelivery.update({ where: { voicemailId: restrictedId }, data: { status: 'PROCESSING' } });
    assert.ok(await tx.voicemail.findUnique({ where: { id: restrictedId } }));
    await tx.voicemail.updateMany({ where: { id: restrictedId }, data: { forwardedToEmailAt: new Date() } });
    throw rolledBack;
  }), (error) => error === rolledBack);
  assert.equal(await db.voicemailEmailDelivery.findUnique({ where: { voicemailId: restrictedId } }), null);
  console.log('PASS: PostgreSQL 18 outbox migration checksum, atomic rollback, concurrent claim, restart recovery, bounded failures, restricted runtime grants');
} finally {
  await db.$disconnect();
}
