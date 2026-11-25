import { test, expect } from '@jest/globals';
import jwt from 'jsonwebtoken';

import { decodeSession, fingerprintSession } from '../sessionAuthority.js';

const secret = process.env.JWT_SECRET || 'test_secret';

test('signed short credential retains its full-session parent authority', () => {
  const full = jwt.sign({ id: 42, typ: 'session', tokenVersion: 2 }, secret, { expiresIn: '1h' });
  const fullAuthority = decodeSession(full);
  const short = jwt.sign({ id: 42, typ: 'short', tokenVersion: 2,
    parentSessionFingerprint: fullAuthority.authorityFingerprint,
    parentSessionExpiresAt: fullAuthority.authorityExpiresAtMs }, secret, { expiresIn: '10m' });
  expect(decodeSession(short)).toMatchObject({
    sessionKind: 'short', authorityFingerprint: fingerprintSession(full),
    pushFingerprint: null,
  });
});

test('legacy unbound and forged short credentials cannot authenticate', () => {
  const legacy = jwt.sign({ id: 42, typ: 'short', tokenVersion: 2 }, secret, { expiresIn: '10m' });
  expect(decodeSession(legacy)).toBeNull();
  const parent = 'a'.repeat(64);
  const bound = jwt.sign({ id: 42, typ: 'short', tokenVersion: 2,
    parentSessionFingerprint: parent, parentSessionExpiresAt: Date.now() + 3600000 },
  secret, { expiresIn: '10m' });
  const [head, payload, signature] = bound.split('.');
  const altered = JSON.parse(Buffer.from(payload, 'base64url').toString());
  altered.parentSessionFingerprint = 'b'.repeat(64);
  expect(decodeSession(`${head}.${Buffer.from(JSON.stringify(altered)).toString('base64url')}.${signature}`)).toBeNull();
});

test('short credential cannot outlive its parent full session', () => {
  const short = jwt.sign({ id: 42, typ: 'short', tokenVersion: 2,
    parentSessionFingerprint: 'a'.repeat(64), parentSessionExpiresAt: Date.now() + 1000 },
  secret, { expiresIn: '10m' });
  expect(decodeSession(short)).toBeNull();
});
