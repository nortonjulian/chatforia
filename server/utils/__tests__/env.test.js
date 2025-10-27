import { requireEnv, assertRequiredEnv, isTrue } from '../../utils/env.js';

const ORIGINAL_ENV = { ...process.env };

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe('requireEnv', () => {
  test('returns the variable value when defined and non-empty', () => {
    process.env.MY_KEY = 'abc123';

    const val = requireEnv('MY_KEY');
    expect(val).toBe('abc123');
  });

  test('throws if the variable is missing', () => {
    delete process.env.MISSING_THING;

    expect(() => requireEnv('MISSING_THING')).toThrow(
      /Missing required environment variable: MISSING_THING/
    );
  });

  test('throws if the variable is empty or whitespace-only (default allowEmpty=false)', () => {
    process.env.EMPTY_KEY = '   ';

    expect(() => requireEnv('EMPTY_KEY')).toThrow(
      /Missing required environment variable: EMPTY_KEY/
    );
  });

  test('with allowEmpty=true, returns even an empty string', () => {
    process.env.CAN_BE_EMPTY = '   ';

    const val = requireEnv('CAN_BE_EMPTY', { allowEmpty: true });
    // Note: it returns the raw value, not trimmed.
    expect(val).toBe('   ');
  });
});

describe('assertRequiredEnv', () => {
  test('does nothing if all required vars are set and non-empty', () => {
    process.env.DB_URL = 'postgres://db';
    process.env.REDIS_URL = 'redis://cache';
    process.env.SECRET = 'shhh';

    expect(() =>
      assertRequiredEnv(['DB_URL', 'REDIS_URL', 'SECRET'])
    ).not.toThrow();
  });

  test('throws once with all missing/empty variable names listed', () => {
    process.env.DB_URL = 'postgres://db';
    process.env.REDIS_URL = '   '; // whitespace-only = treated as missing
    delete process.env.SECRET;

    expect(() =>
      assertRequiredEnv(['DB_URL', 'REDIS_URL', 'SECRET'])
    ).toThrow(
      /Missing required environment variables: REDIS_URL, SECRET/
    );
  });
});

describe('isTrue', () => {
  test('returns true only when the value (case-insensitive) is "true"', () => {
    expect(isTrue('true')).toBe(true);
    expect(isTrue('TRUE')).toBe(true);
    expect(isTrue('TrUe')).toBe(true);
  });

  test('returns false for "false", "0", "", null, undefined, etc.', () => {
    expect(isTrue('false')).toBe(false);
    expect(isTrue('0')).toBe(false);
    expect(isTrue('')).toBe(false);
    expect(isTrue('   ')).toBe(false);
    expect(isTrue(null)).toBe(false);
    expect(isTrue(undefined)).toBe(false);
  });
});
