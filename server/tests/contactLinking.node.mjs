import test from 'node:test';
import assert from 'node:assert/strict';
import { upsertLinkedPhoneContact } from '../services/linkedPhoneContactService.js';

function database(contacts = [], threads = []) {
  const db = { contacts: structuredClone(contacts), threads: structuredClone(threads) };
  db.$transaction = async (fn) => {
    const saved = structuredClone({ contacts: db.contacts, threads: db.threads });
    const tx = {
      $executeRaw: async () => 1,
      contact: {
        findUnique: async ({ where }) => {
          const key = where.ownerId_userId || where.ownerId_externalPhone;
          return db.contacts.find(c => c.ownerId === key.ownerId &&
            (key.userId != null ? c.userId === key.userId : c.externalPhone === key.externalPhone)) || null;
        },
        update: async ({ where, data }) => {
          const item = db.contacts.find(c => c.id === where.id);
          assert.ok(item);
          const other = db.contacts.find(c => c.id !== item.id && c.ownerId === item.ownerId &&
            (c.userId === data.userId || c.externalPhone === data.externalPhone));
          if (other) throw new Error('unique conflict');
          Object.assign(item, data);
          return item;
        },
        delete: async ({ where }) => {
          if (db.threads.some(t => t.contactId === where.id)) throw new Error('foreign key conflict');
          db.contacts = db.contacts.filter(c => c.id !== where.id);
        },
        create: async ({ data }) => {
          const item = { id: 100, ...data };
          db.contacts.push(item);
          return item;
        },
      },
      smsThread: {
        updateMany: async ({ where, data }) => {
          for (const thread of db.threads) {
            if (thread.contactId === where.contactId && thread.userId === where.userId) {
              Object.assign(thread, data);
            }
          }
        },
      },
    };
    try { return await fn(tx); }
    catch (error) {
      db.contacts = saved.contacts; db.threads = saved.threads;
      throw error;
    }
  };
  return db;
}

const input = { ownerId: 65, userId: 1, externalPhone: '+17609249652' };

test('merges the saved user and phone rows and preserves SMS thread links', async () => {
  const db = database([
    { id: 17, ownerId: 65, userId: 1, externalPhone: null, alias: 'Julian', favorite: false },
    { id: 18, ownerId: 65, userId: null, externalPhone: input.externalPhone,
      externalName: 'Julian Norton', favorite: true },
    { id: 19, ownerId: 66, userId: null, externalPhone: input.externalPhone },
  ], [{ id: 2, userId: 65, contactId: 18 }]);
  const contact = await upsertLinkedPhoneContact(db, { ...input, favorite: false });
  assert.equal(contact.id, 17);
  assert.equal(contact.userId, 1);
  assert.equal(contact.externalPhone, input.externalPhone);
  assert.equal(contact.alias, 'Julian');
  assert.equal(contact.externalName, 'Julian Norton');
  assert.equal(contact.favorite, true);
  assert.equal(db.threads[0].contactId, 17);
  assert.equal(db.contacts.length, 2);
  assert.equal(db.contacts.find(c => c.id === 19).userId, null);
  await upsertLinkedPhoneContact(db, input);
  assert.equal(db.contacts.length, 2);
});

test('links an existing phone row without creating another contact', async () => {
  const db = database([{ id: 18, ownerId: 65, userId: null, externalPhone: input.externalPhone }]);
  const contact = await upsertLinkedPhoneContact(db, input);
  assert.equal(contact.id, 18);
  assert.equal(contact.userId, 1);
  assert.equal(db.contacts.length, 1);
});

test('creates a linked contact when neither row exists', async () => {
  const db = database();
  const contact = await upsertLinkedPhoneContact(db, input);
  assert.equal(contact.ownerId, 65);
  assert.equal(contact.userId, 1);
  assert.equal(db.contacts.length, 1);
});

test('rejects a number already linked to a different user', async () => {
  const db = database([{ id: 18, ownerId: 65, userId: 9, externalPhone: input.externalPhone }]);
  await assert.rejects(upsertLinkedPhoneContact(db, input), error => error.status === 409);
  assert.equal(db.contacts[0].userId, 9);
});

test('preserves a different existing number rather than silently replacing it', async () => {
  const db = database([{ id: 17, ownerId: 65, userId: 1, externalPhone: '+14155550101' }]);
  await assert.rejects(upsertLinkedPhoneContact(db, input), error => error.status === 409);
  assert.equal(db.contacts[0].externalPhone, '+14155550101');
});

test('rolls back a merge if a remaining thread reference prevents deletion', async () => {
  const db = database([
    { id: 17, ownerId: 65, userId: 1, externalPhone: null },
    { id: 18, ownerId: 65, userId: null, externalPhone: input.externalPhone },
  ], [{ id: 2, userId: 66, contactId: 18 }]);
  await assert.rejects(upsertLinkedPhoneContact(db, input), /foreign key conflict/);
  assert.equal(db.contacts.length, 2);
  assert.equal(db.contacts[0].externalPhone, null);
  assert.equal(db.threads[0].contactId, 18);
});
