import test from 'node:test';
import assert from 'node:assert/strict';
import speakeasy from 'speakeasy';
import { codeSnapshot, helperHtml } from './staff-shell-helper.mjs';
const accounts = [
  { id: 1, username: 'qa_founder' },
  { id: 2, username: 'qa_admin' },
];
const secrets = new Map(
  accounts.map((a) => [a.username, speakeasy.generateSecret().base32])
);
test('snapshot uses explicit server time and matches actual verifier', () => {
  const now = 1800000010000;
  const snapshot = codeSnapshot(accounts, secrets, now);
  assert.equal(snapshot.accounts.length, 1);
  assert.equal(snapshot.accounts[0].username, 'qa_admin');
  assert.equal(
    speakeasy.totp.verify({
      secret: secrets.get('qa_admin'),
      encoding: 'base32',
      token: snapshot.accounts[0].code,
      time: Math.floor(now / 1000),
      window: 1,
    }),
    true
  );
  assert.equal(
    JSON.stringify(snapshot).includes(secrets.get('qa_admin')),
    false
  );
});
test('near-expiry code is withheld and next period produces a valid code', () => {
  const boundary = 1800000030000;
  assert.equal(
    codeSnapshot(accounts, secrets, boundary - 5000).accounts[0].code,
    null
  );
  assert.equal(
    codeSnapshot(accounts, secrets, boundary - 1).accounts[0].code,
    null
  );
  assert.match(
    codeSnapshot(accounts, secrets, boundary).accounts[0].code,
    /^\d{6}$/
  );
});
test('helper has no meta refresh, no embedded MFA seed and documents challenge expiry', () => {
  const html = helperHtml('synthetic-password', '/__synthetic/test/codes');
  assert.equal(html.includes('http-equiv="refresh"'), false);
  assert.equal(html.includes(secrets.get('qa_admin')), false);
  assert.match(html, /five minutes/);
  assert.match(html, /visibilitychange/);
  assert.match(html, /no-store/);
});
