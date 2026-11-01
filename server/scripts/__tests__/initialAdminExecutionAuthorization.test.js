import {
  INITIAL_ADMIN_EXECUTION_CONFIRMATION,
  validateInitialAdminExecutionAuthorization,
} from '../initialAdminExecutionAuthorization.js';

const valid = () => ({
  execute: true,
  accountEmail: 'julian@chatforia.com',
  confirmation: INITIAL_ADMIN_EXECUTION_CONFIRMATION,
});

describe('initial administrator execution authorization', () => {
  test('accepts exact explicit authorization', () => {
    expect(
      validateInitialAdminExecutionAuthorization(valid())
    ).toEqual({
      authorized: true,
      accountEmail: 'julian@chatforia.com',
    });
  });

  test.each([
    false,
    undefined,
    null,
    'true',
    1,
  ])('rejects invalid execution authorization: %s', (execute) => {
    expect(() => validateInitialAdminExecutionAuthorization({
      ...valid(),
      execute,
    })).toThrow(
      'Explicit administrator execution authorization required'
    );
  });

  test.each([
    'someone@example.com',
    'julian@anotherdomain.com',
    'JULIAN@CHATFORIA.COM',
    '',
    null,
    undefined,
  ])('rejects unexpected account identity: %s', (accountEmail) => {
    expect(() => validateInitialAdminExecutionAuthorization({
      ...valid(),
      accountEmail,
    })).toThrow('Administrator execution account mismatch');
  });

  test.each([
    '',
    'yes',
    'PROMOTE julian@chatforia.com',
    'PROMOTE someone@example.com ON defaultdb',
    'PROMOTE julian@chatforia.com ON another_database',
    null,
    undefined,
  ])('rejects incorrect confirmation: %s', (confirmation) => {
    expect(() => validateInitialAdminExecutionAuthorization({
      ...valid(),
      confirmation,
    })).toThrow('Administrator execution confirmation mismatch');
  });
});
