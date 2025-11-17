import {
  describe,
  test,
  expect,
} from '@jest/globals';

const { default: invariant } = await import('../../utils/invariant.js');

describe('invariant util', () => {
  test('does nothing when condition is truthy', () => {
    expect(() => invariant(true, 'should not throw')).not.toThrow();
    expect(() => invariant(123, 'should not throw')).not.toThrow();
    expect(() => invariant('non-empty', 'should not throw')).not.toThrow();
  });

  test('throws Error with default message and code when condition is falsy and no message is provided', () => {
    try {
      invariant(false);
      // If we get here, it didn’t throw (which is wrong)
      throw new Error('Expected invariant(false) to throw');
    } catch (err) {
      expect(err).toBeInstanceOf(Error);
      expect(err.message).toBe('Invariant failed');
      expect(err.code).toBe('CONFIG_INVARIANT');
    }
  });

  test('throws Error with custom message and code when condition is falsy and message is provided', () => {
    const msg = 'Missing required config: TWILIO_ACCOUNT_SID';

    try {
      invariant(0, msg); // falsy
      throw new Error('Expected invariant(0, msg) to throw');
    } catch (err) {
      expect(err).toBeInstanceOf(Error);
      expect(err.message).toBe(msg);
      expect(err.code).toBe('CONFIG_INVARIANT');
    }
  });
});
