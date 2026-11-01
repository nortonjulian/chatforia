import { describe, test, expect } from '@jest/globals';
import { hasVerifiedAdminAccess } from '../verifiedAdmin.js';

const requestFor = ({
  role = 'ADMIN',
  enabled = true,
  verified = true,
} = {}) => ({
  user: {
    id: 42,
    role,
    twoFactorEnabled: enabled,
  },
  auth: {
    mfaVerified: verified,
  },
});

describe('hasVerifiedAdminAccess', () => {
  test('allows MFA-verified global administrator', () => {
    expect(hasVerifiedAdminAccess(requestFor())).toBe(true);
  });

  test('rejects administrator without MFA enrollment', () => {
    expect(hasVerifiedAdminAccess(
      requestFor({ enabled: false })
    )).toBe(false);
  });

  test.each([false, undefined, null, 'true'])(
    'rejects invalid MFA proof: %p',
    (verified) => {
      const req = requestFor();
      req.auth.mfaVerified = verified;

      expect(hasVerifiedAdminAccess(req)).toBe(false);
    }
  );

  test('rejects ordinary users even with MFA proof', () => {
    expect(hasVerifiedAdminAccess(
      requestFor({ role: 'USER' })
    )).toBe(false);
  });

  test('rejects missing request or authentication data', () => {
    expect(hasVerifiedAdminAccess(null)).toBe(false);
    expect(hasVerifiedAdminAccess({})).toBe(false);
    expect(hasVerifiedAdminAccess({
      user: { role: 'ADMIN', twoFactorEnabled: true },
    })).toBe(false);
  });

  test('rejects room-level administrator role without global role', () => {
    expect(hasVerifiedAdminAccess(
      requestFor({ role: 'USER' })
    )).toBe(false);
  });
});
