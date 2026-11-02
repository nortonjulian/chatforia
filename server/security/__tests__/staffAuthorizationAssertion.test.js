import { jest } from '@jest/globals';

import {
  createStaffAuthorizationAssertion,
  verifyStaffAuthorizationAssertion,
  STAFF_ASSERTION_LIFETIME_SECONDS,
} from '../staffAuthorizationAssertion.js';

const SECRET = 'qa-only-independent-staff-signing-secret-123456';
const NOW = 1900000000;

function issue(overrides = {}, options = {}) {
  return createStaffAuthorizationAssertion({
    actorUserId: 14,
    targetUserId: 16,
    action: 'STAFF_ACCESS_GRANT_OR_CHANGE',
    targetProfile: 'SENIOR_ENGINEER',
    tokenVersion: 4,
    mfaVerified: true,
    ...overrides,
  }, {
    secret: SECRET,
    nowSeconds: NOW,
    ...options,
  });
}

function verify(token, options = {}) {
  return verifyStaffAuthorizationAssertion(token, {
    secret: SECRET,
    nowSeconds: NOW,
    ...options,
  });
}

describe('Staff authorization assertions', () => {
  test('creates and verifies a valid assertion', () => {
    const token = issue();
    const claims = verify(token);

    expect(claims).toMatchObject({
      iss: 'chatforia-staff-access',
      aud: 'chatforia-staff-database',
      typ: 'staff_authorization',
      actorUserId: 14,
      targetUserId: 16,
      action: 'STAFF_ACCESS_GRANT_OR_CHANGE',
      targetProfile: 'SENIOR_ENGINEER',
      tokenVersion: 4,
      mfaVerified: true,
      iat: NOW,
      exp: NOW + STAFF_ASSERTION_LIFETIME_SECONDS,
    });

    expect(claims.jti).toBeTruthy();
  });

  test('generates unique assertion identifiers', () => {
    const first = verify(issue());
    const second = verify(issue());

    expect(first.jti).not.toBe(second.jti);
  });

  test('binds the assertion to its requested operation', () => {
    const claims = verify(issue({
      action: 'STAFF_ACCESS_REVOKE',
      targetProfile: 'SUPPORT',
    }));

    expect(claims.action).toBe('STAFF_ACCESS_REVOKE');
    expect(claims.targetProfile).toBe('SUPPORT');
  });

  test('expires assertions after 60 seconds', () => {
    const token = issue();

    expect(verify(token, {
      nowSeconds: NOW + 59,
    })).not.toBeNull();

    expect(verify(token, {
      nowSeconds: NOW + 60,
    })).toBeNull();
  });

  test('rejects signatures created with another secret', () => {
    expect(
      verifyStaffAuthorizationAssertion(issue(), {
        secret: 'another-independent-secret-1234567890',
        nowSeconds: NOW,
      })
    ).toBeNull();
  });

  test('rejects modified payloads', () => {
    const token = issue();
    const [payload, signature] = token.split('.');

    const modified = Buffer.from(
      JSON.stringify({
        ...JSON.parse(
          Buffer.from(payload, 'base64url').toString('utf8')
        ),
        targetUserId: 18,
      })
    ).toString('base64url');

    expect(verify(`${modified}.${signature}`)).toBeNull();
  });

  test('rejects missing MFA verification', () => {
    expect(() => issue({ mfaVerified: false }))
      .toThrow(/MFA/);
  });

  test('rejects invalid actor and target identities', () => {
    for (const overrides of [
      { actorUserId: 0 },
      { targetUserId: -1 },
      { actorUserId: 16 },
      { targetUserId: '16' },
    ]) {
      expect(() => issue(overrides)).toThrow();
    }
  });

  test('rejects invalid actions and profiles', () => {
    expect(() => issue({ action: 'DELETE_USER' })).toThrow();
    expect(() => issue({ targetProfile: 'SUPERADMIN' })).toThrow();
  });

  test('rejects invalid token versions', () => {
    expect(() => issue({ tokenVersion: -1 })).toThrow();
    expect(() => issue({ tokenVersion: 1.5 })).toThrow();
  });

  test('rejects missing and malformed tokens', () => {
    for (const token of [
      null,
      undefined,
      '',
      'invalid',
      'a.b.c',
      'not-json.signature',
    ]) {
      expect(verify(token)).toBeNull();
    }
  });

  test('rejects insufficient signing secrets', () => {
    expect(() => issue({}, {
      secret: 'too-short',
    })).toThrow(/32 bytes/);

    expect(verify(issue(), {
      secret: 'too-short',
    })).toBeNull();
  });

  test('rejects assertions from the future', () => {
    const token = issue({}, {
      nowSeconds: NOW + 10,
    });

    expect(verify(token)).toBeNull();
  });

  test('rejects unsupported token types and audiences', () => {
    const token = issue();
    const [payload] = token.split('.');

    const claims = JSON.parse(
      Buffer.from(payload, 'base64url').toString('utf8')
    );

    claims.typ = 'session';

    const forged = Buffer.from(
      JSON.stringify(claims)
    ).toString('base64url');

    expect(verify(`${forged}.${'0'.repeat(43)}`)).toBeNull();
  });

  test('rejects excessive assertion lifetimes', () => {
    const token = issue();
    const [payload, signature] = token.split('.');

    const claims = JSON.parse(
      Buffer.from(payload, 'base64url').toString('utf8')
    );

    claims.exp = NOW + 600;

    const modified = Buffer.from(
      JSON.stringify(claims)
    ).toString('base64url');

    expect(verify(`${modified}.${signature}`)).toBeNull();
  });
});
