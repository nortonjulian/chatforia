import {
  INITIAL_ADMIN_EMAIL,
  validateInitialAdminAccount,
} from '../initialAdminBootstrapValidation.js';

const validAccount = () => ({
  id: 42,
  email: INITIAL_ADMIN_EMAIL,
  role: 'USER',
  isBanned: false,
  deletedAt: null,
  emailVerifiedAt: new Date(),
  twoFactorEnabled: true,
  totpSecretEnc: 'encrypted-test-secret',
  twoFactorEnrolledAt: new Date(),
  tokenVersion: 3,
});

describe('initial administrator bootstrap validation', () => {
  test('accepts verified company account with MFA', () => {
    expect(validateInitialAdminAccount(validAccount())).toEqual({
      id: 42,
      email: INITIAL_ADMIN_EMAIL,
      role: 'USER',
      tokenVersion: 3,
    });
  });

  test.each([
    null,
    undefined,
    0,
    -1,
    1.5,
    NaN,
    '42',
    2147483648,
  ])('rejects invalid target account ID: %s', (id) => {
    expect(() => validateInitialAdminAccount({
      ...validAccount(),
      id,
    })).toThrow('Invalid target account ID');
  });

  test('rejects missing account', () => {
    expect(() => validateInitialAdminAccount(null))
      .toThrow('Target account not found');
  });

  test.each([
    'someone@example.com',
    'julian@anotherdomain.com',
    '',
    null,
  ])('rejects unexpected email identity: %s', (email) => {
    expect(() => validateInitialAdminAccount({
      ...validAccount(),
      email,
    })).toThrow('Unexpected administrator account identity');
  });

  test('rejects existing administrator', () => {
    expect(() => validateInitialAdminAccount({
      ...validAccount(),
      role: 'ADMIN',
    })).toThrow('Target account must have USER role');
  });

  test.each([
    { isBanned: true },
    { deletedAt: new Date() },
  ])('rejects unavailable account: %p', (change) => {
    expect(() => validateInitialAdminAccount({
      ...validAccount(),
      ...change,
    })).toThrow('Target account is unavailable');
  });

  test('rejects unverified email', () => {
    expect(() => validateInitialAdminAccount({
      ...validAccount(),
      emailVerifiedAt: null,
    })).toThrow('Target email is not verified');
  });

  test.each([
    { twoFactorEnabled: false },
    { totpSecretEnc: null },
    { twoFactorEnrolledAt: null },
  ])('rejects incomplete MFA enrollment: %p', (change) => {
    expect(() => validateInitialAdminAccount({
      ...validAccount(),
      ...change,
    })).toThrow('Target account MFA enrollment is incomplete');
  });

  test.each([-1, 1.5, NaN, null, undefined])(
    'rejects invalid session version: %s',
    (tokenVersion) => {
      expect(() => validateInitialAdminAccount({
        ...validAccount(),
        tokenVersion,
      })).toThrow('Invalid session version');
    }
  );
});
