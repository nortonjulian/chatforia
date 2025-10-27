/**
 * server/utils/__tests__/phone.test.js
 *
 * FINAL VERSION:
 * We only test the real implementations from utils/phone.js.
 * No jest.unstable_mockModule(), no dynamic mocking.
 *
 * We import with a namespace import (`* as phoneUtils`) so that
 * we can call the named exports directly.
 */

import * as phoneUtils from '../../utils/phone.js';

describe('phone utils (integration with real parser)', () => {
  test('toE164: US local number uses defaultCountry and formats to +E.164', () => {
    const { toE164 } = phoneUtils;

    // Plain 10-digit US number
    const out = toE164('4155552671', 'US');
    expect(out).toBe('+14155552671');

    // Messy formatting still normalizes
    const out2 = toE164('(415) 555-2671', 'US');
    expect(out2).toBe('+14155552671');
  });

  test('toE164: numbers starting with "+" bypass region and are returned directly if valid', () => {
    const { toE164 } = phoneUtils;

    // Should ignore the provided country and trust the '+'
    const out = toE164('+14155552671', 'US');
    expect(out).toBe('+14155552671');
  });

  test('toE164: custom defaultCountry works (GB example)', () => {
    const { toE164 } = phoneUtils;

    // UK-style "07700..." should become +44 without the leading 0
    const out = toE164('07700900123', 'GB');
    expect(out).toBe('+447700900123');
  });

  test('toE164: returns null for invalid or unparsable input', () => {
    const { toE164 } = phoneUtils;

    // Too short to be valid US number
    const out1 = toE164('123', 'US');
    expect(out1).toBeNull();

    // Nonsense should be null
    const out2 = toE164('NOT A NUMBER', 'US');
    expect(out2).toBeNull();

    // Empty string -> null
    const out3 = toE164('', 'US');
    expect(out3).toBeNull();

    // undefined -> null
    const out4 = toE164(undefined, 'US');
    expect(out4).toBeNull();
  });

  test('digitsOnly strips all non-digits and tolerates undefined', () => {
    const { digitsOnly } = phoneUtils;

    expect(digitsOnly('(415) 555-2671')).toBe('4155552671');
    expect(digitsOnly('+44 7700 900123')).toBe('447700900123');
    expect(digitsOnly('abc123xyz')).toBe('123');
    expect(digitsOnly()).toBe('');
  });

  test('normalizeE164 is just an alias to toE164 (US default)', () => {
    const { normalizeE164, toE164 } = phoneUtils;

    const raw = '4155552671';

    const a = normalizeE164(raw); // implicit 'US'
    const b = toE164(raw, 'US');

    expect(a).toBe(b);
    expect(a).toBe('+14155552671');
  });

  test('isE164 returns true/false based on successful toE164 parse', () => {
    const { isE164 } = phoneUtils;

    expect(isE164('4155552671', 'US')).toBe(true);
    expect(isE164('+14155552671')).toBe(true); // already E.164

    expect(isE164('not a phone', 'US')).toBe(false);
    expect(isE164('123', 'US')).toBe(false);
    expect(isE164('', 'US')).toBe(false);
    expect(isE164(undefined, 'US')).toBe(false);
  });
});
