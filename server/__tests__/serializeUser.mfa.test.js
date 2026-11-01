/**
 * @jest-environment node
 */
import { serializeUser } from '../utils/serializeUser.js';

describe('MFA user serialization', () => {
  const baseUser = {
    id: 66,
    username: 'test-admin-candidate',
    email: 'test@example.invalid',
    role: 'USER',
    plan: 'FREE',
    theme: 'dawn',
    totpSecretEnc: 'DO-NOT-EXPOSE',
    twoFactorRecoveryCodes: [
      { codeHash: 'DO-NOT-EXPOSE' },
    ],
  };

  test.each([
    [true, true],
    [false, false],
    [undefined, false],
  ])(
    'serializes twoFactorEnabled=%s as %s',
    (stored, expected) => {
      const result = serializeUser({
        ...baseUser,
        twoFactorEnabled: stored,
      });

      expect(result.twoFactorEnabled).toBe(expected);
      expect(result).not.toHaveProperty('totpSecretEnc');
      expect(result).not.toHaveProperty('twoFactorRecoveryCodes');
      expect(JSON.stringify(result)).not.toContain('DO-NOT-EXPOSE');
    }
  );
});
