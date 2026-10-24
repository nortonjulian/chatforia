// Rollback-only, real Prisma integration check for re-added SMS contact names.
// Requires an explicitly selected local disposable PostgreSQL test database.
// NEVER point this script at staging or production.
import assert from 'node:assert/strict';
import { randomInt, randomUUID } from 'node:crypto';
import { assertTestDatabaseSelected } from '../server/__tests__/helpers/testDatabase.js';
import { loadSmsContactNames } from '../server/services/smsContactNames.js';

const { raw } = assertTestDatabaseSelected();
const target = new URL(raw);
if (!['localhost', '127.0.0.1', '[::1]'].includes(target.hostname)) {
  throw new Error('Refusing database access: SMS contact QA requires local PostgreSQL.');
}

const { PrismaClient } = await import('@prisma/client');
const db = new PrismaClient({ datasources: { db: { url: raw } } });
const rollback = new Error('Intentional QA rollback');

try {
  await db.$transaction(async (tx) => {
    const nonce = randomUUID().replaceAll('-', '');
    const owner = await tx.user.create({
      data: { username: `smsname_owner_${nonce}`, passwordHash: 'test-fixture-not-a-login' },
    });
    const account = await tx.user.create({
      data: {
        username: `smsname_peer_${nonce}`, displayName: 'Papi',
        passwordHash: 'test-fixture-not-a-login',
      },
    });
    const stranger = await tx.user.create({
      data: { username: `smsname_other_${nonce}`, passwordHash: 'test-fixture-not-a-login' },
    });
    const peerPhone = `+1555${randomInt(1000000, 9999999)}`;
    await tx.phoneNumber.create({
      data: {
        e164: peerPhone, provider: 'test-fixture', status: 'ASSIGNED',
        assignedUserId: account.id, assignedAt: new Date(),
      },
    });

    // A thread can outlive its saved contact. Before re-adding, show the phone.
    let names = await loadSmsContactNames(tx, owner.id, [peerPhone]);
    assert.equal(names.get(peerPhone), undefined);

    // Re-adding only by Chatforia user ID has externalPhone=null.
    await tx.contact.create({
      data: { ownerId: owner.id, userId: account.id, alias: 'Re-added Papi' },
    });
    names = await loadSmsContactNames(tx, owner.id, [peerPhone]);
    assert.equal(names.get(peerPhone), 'Re-added Papi');

    // A different user without that contact must not inherit the label.
    names = await loadSmsContactNames(tx, stranger.id, [peerPhone]);
    assert.equal(names.get(peerPhone), undefined);

    // Explicit saved-number alias takes precedence over account-only alias.
    const numberContact = await tx.contact.create({
      data: { ownerId: owner.id, externalPhone: peerPhone, alias: 'Phone Label' },
    });
    names = await loadSmsContactNames(tx, owner.id, [peerPhone]);
    assert.equal(names.get(peerPhone), 'Phone Label');

    await tx.contact.delete({ where: { id: numberContact.id } });
    names = await loadSmsContactNames(tx, owner.id, [peerPhone]);
    assert.equal(names.get(peerPhone), 'Re-added Papi');

    console.log('PASS: Prisma user/assigned-number relation, re-add, owner isolation, and alias precedence');
    throw rollback; // Every fixture is rolled back even after all assertions pass.
  }, { timeout: 15000 });
} catch (error) {
  if (error !== rollback) throw error;
} finally {
  await db.$disconnect();
}
console.log('PASS: integration transaction rolled back; no QA fixtures persisted');
