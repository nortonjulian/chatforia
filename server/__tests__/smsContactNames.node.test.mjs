import test from 'node:test';
import assert from 'node:assert/strict';
import { loadSmsContactNames, smsPhoneKeys } from '../services/smsContactNames.js';

test('phone variants cover E164 and digits', () => {
  assert.deepEqual(smsPhoneKeys('+1 (760) 555-0100'), ['+17605550100', '17605550100']);
});

test('re-added account-only contact resolves through currently assigned number', async () => {
  const db = { contact: { findMany: async () => [{
    alias: null, externalName: null, externalPhone: null,
    user: { username: 'papi', displayName: 'Papi', phoneNumber: null,
      phoneVerifiedAt: null, assignedNumbers: [{ e164: '+17605550100' }] },
  }] } };
  const names = await loadSmsContactNames(db, 65, ['+17605550100']);
  assert.equal(names.get('+17605550100'), 'Papi');
});

test('explicit saved phone alias wins, unrelated numbers remain unresolved', async () => {
  const db = { contact: { findMany: async () => [
    { alias: 'My Friend', externalPhone: '+17605550100', externalName: null, user: null },
    { alias: 'Alias of user', externalPhone: null, externalName: null,
      user: { username: 'papi', displayName: 'Papi', phoneNumber: '+17605550100',
        phoneVerifiedAt: new Date(), assignedNumbers: [] } },
  ] } };
  const names = await loadSmsContactNames(db, 65, ['17605550100', '+19995550123']);
  assert.equal(names.get('+17605550100'), 'My Friend');
  assert.equal(names.has('+19995550123'), false);
});

test('unverified profile phone is not trusted as account identity', async () => {
  const db = { contact: { findMany: async () => [{
    alias: null, externalName: null, externalPhone: null,
    user: { username: 'papi', displayName: 'Papi', phoneNumber: '+17605550100',
      phoneVerifiedAt: null, assignedNumbers: [] },
  }] } };
  const names = await loadSmsContactNames(db, 65, ['+17605550100']);
  assert.equal(names.size, 0);
});
