import { jest } from '@jest/globals';

// We need to mock the 'validator' module before importing validateUser.js.
// We'll control isEmail() return values in each test.

jest.unstable_mockModule('validator', () => ({
  default: {
    isEmail: (input) => {
      // basic mock behavior:
      // treat anything containing '@good.com' as valid,
      // everything else invalid.
      return typeof input === 'string' && input.endsWith('@good.com');
    },
    // if you use any other validator methods in the future,
    // you'll add them here so tests don't explode
  },
}));

let validateRegistrationInput;

beforeAll(async () => {
  const mod = await import('../../utils/validateUser.js');
  validateRegistrationInput = mod.validateRegistrationInput;
});

describe('validateRegistrationInput', () => {
  const REQUIRED_MSG = 'Username, email, and password are required';
  const EMAIL_MSG = 'Invalid email address.';
  const PW_MSG =
    'Password must be at least 8 characters long, include one uppercase letter, and one number.';

  test('returns error if any required field is missing', () => {
    expect(
      validateRegistrationInput('', 'test@good.com', 'Password1')
    ).toBe(REQUIRED_MSG);

    expect(
      validateRegistrationInput('user', '', 'Password1')
    ).toBe(REQUIRED_MSG);

    expect(
      validateRegistrationInput('user', 'test@good.com', '')
    ).toBe(REQUIRED_MSG);

    expect(
      validateRegistrationInput('', '', '')
    ).toBe(REQUIRED_MSG);
  });

  test('returns error if email is invalid', () => {
    // Our mock marks anything not ending in @good.com as invalid
    const result = validateRegistrationInput(
      'user',
      'bad@example.com',
      'Password1'
    );
    expect(result).toBe(EMAIL_MSG);
  });

  test('rejects password shorter than 8 chars', () => {
    const result = validateRegistrationInput(
      'user',
      'test@good.com',
      'Abc123' // 6 chars
    );
    expect(result).toBe(PW_MSG);
  });

  test('rejects password missing uppercase', () => {
    // no uppercase letter
    const result = validateRegistrationInput(
      'user',
      'test@good.com',
      'password1'
    );
    expect(result).toBe(PW_MSG);
  });

  test('rejects password missing a number', () => {
    // has uppercase but no number
    const result = validateRegistrationInput(
      'user',
      'test@good.com',
      'Password'
    );
    expect(result).toBe(PW_MSG);
  });

  test('returns undefined when all inputs are valid', () => {
    // valid username
    // valid email according to our mock (endsWith @good.com)
    // password: >=8 chars, has uppercase, has digit
    const result = validateRegistrationInput(
      'jules',
      'hello@good.com',
      'StrongPass9'
    );
    expect(result).toBeUndefined();
  });
});
