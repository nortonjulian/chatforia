import {
  isEligibleStaffActor,
  isEligibleStaffTarget,
} from '../staffAccountEligibility.js';

const validUser = () => ({
  id: 42,
  role: 'USER',
  isBanned: false,
  deletedAt: null,
  isSystem: false,
  isTestAccount: false,
  emailVerifiedAt: new Date(),
  twoFactorEnabled: true,
  twoFactorEnrolledAt: new Date(),
  totpSecretEnc: 'encrypted-totp-secret',
});

const verifiedSession = { mfaVerified: true };

describe('staff account eligibility', () => {
  test('accepts eligible actor with verified MFA', () => {
    expect(
      isEligibleStaffActor(validUser(), verifiedSession)
    ).toBe(true);
  });

  test('rejects actor without verified MFA session', () => {
    for (const authentication of [
      null,
      {},
      { mfaVerified: false },
      { mfaVerified: 'true' },
    ]) {
      expect(
        isEligibleStaffActor(validUser(), authentication)
      ).toBe(false);
    }
  });

  test('rejects actor without completed MFA enrollment', () => {
    for (const changes of [
      { twoFactorEnabled: false },
      { twoFactorEnrolledAt: null },
      { totpSecretEnc: null },
      { totpSecretEnc: '' },
    ]) {
      expect(isEligibleStaffActor({
        ...validUser(),
        ...changes,
      }, verifiedSession)).toBe(false);
    }
  });

  test('rejects unavailable or special actor accounts', () => {
    for (const changes of [
      { isBanned: true },
      { deletedAt: new Date() },
      { isSystem: true },
      { isTestAccount: true },
      { role: 'ADMIN' },
    ]) {
      expect(isEligibleStaffActor({
        ...validUser(),
        ...changes,
      }, verifiedSession)).toBe(false);
    }
  });

  test('accepts eligible staff target', () => {
    expect(isEligibleStaffTarget(validUser())).toBe(true);
  });

  test('rejects targets without verified email or MFA', () => {
    for (const changes of [
      { emailVerifiedAt: null },
      { twoFactorEnabled: false },
      { twoFactorEnrolledAt: null },
      { totpSecretEnc: null },
      { totpSecretEnc: '' },
    ]) {
      expect(isEligibleStaffTarget({
        ...validUser(),
        ...changes,
      })).toBe(false);
    }
  });

  test('rejects unavailable or privileged targets', () => {
    for (const changes of [
      { isBanned: true },
      { deletedAt: new Date() },
      { isSystem: true },
      { isTestAccount: true },
      { role: 'ADMIN' },
    ]) {
      expect(isEligibleStaffTarget({
        ...validUser(),
        ...changes,
      })).toBe(false);
    }
  });

  test('rejects invalid account identifiers', () => {
    for (const id of [
      null, 0, -1, '42', 1.5, 2147483648,
    ]) {
      const user = { ...validUser(), id };

      expect(
        isEligibleStaffActor(user, verifiedSession)
      ).toBe(false);

      expect(isEligibleStaffTarget(user)).toBe(false);
    }
  });

  test('rejects missing account records', () => {
    expect(
      isEligibleStaffActor(null, verifiedSession)
    ).toBe(false);

    expect(isEligibleStaffTarget(null)).toBe(false);
  });
});
