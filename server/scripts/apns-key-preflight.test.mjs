import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkApnsKey } from './apns-key-preflight.mjs';

test('accepts an accessible APNs key file', () => {
  const dir = mkdtempSync(join(tmpdir(), 'chatforia-apns-'));
  try {
    const key = join(dir, 'test.p8');
    writeFileSync(key, 'test fixture');
    assert.equal(checkApnsKey({ APNS_KEY: key }), 'file');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('rejects missing APNs configuration', () => {
  assert.throws(
    () => checkApnsKey({}),
    /key configuration missing/
  );
});

test('rejects a missing key file', () => {
  assert.throws(
    () => checkApnsKey({ APNS_KEY: '/nonexistent/apns-test-key.p8' }),
    /configured key is unreadable/
  );
});

test('rejects unsupported key configuration', () => {
  assert.throws(
    () => checkApnsKey({ APNS_KEY: 'invalid-value' }),
    /unsupported key configuration/
  );
});

test('accepts inline key configuration', () => {
  assert.equal(
    checkApnsKey({
      APNS_KEY: '-----BEGIN PRIVATE KEY-----\ntest\n-----END PRIVATE KEY-----'
    }),
    'inline'
  );
});
