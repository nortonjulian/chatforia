import { jest } from '@jest/globals';

const DUMMY_US_E164 = '+14155552671';
const DUMMY_GB_E164 = '+447700900123';

function makeParseMock() {
  // emulate libphonenumber-js parsePhoneNumberFromString
  // We'll match some specific inputs and otherwise return null.
  return jest.fn((raw, region) => {
    const str = String(raw || '').trim();

    // Case 1: already E.164 US number with +
    if (str === DUMMY_US_E164) {
      return {
        isValid: () => true,
        number: DUMMY_US_E164,
      };
    }

    // Case 2: US local 4155552671, allowed only with defaultCountry 'US'
    if ((str === '4155552671' || str === '(415) 555-2671') && region === 'US') {
      return {
        isValid: () => true,
        number: DUMMY_US_E164,
      };
    }

    // Case 3: pretend UK local number "07700900123" under region 'GB'
    if (str === '07700900123' && region === 'GB') {
      return {
        isValid: () => true,
        number: DUMMY_GB_E164,
      };
    }

    // Case 4: something that looks like an international number with +
    if (str === DUMMY_GB_E164) {
      // region should be ignored by our wrapper in this branch
      return {
        isValid: () => true,
        number: DUMMY_GB_E164,
      };
    }

    // Invalid example: returns an object but .isValid() === false
    if (str === '123') {
      return {
        isValid: () => false,
        number: '+1123', // wouldn't matter, isValid false dominates
      };
    }

    // Everything else -> not parsed
    return null;
  });
}

async function loadPhoneModuleWithMock(parseMock) {
  jest.resetModules();

  jest.unstable_mockModule('libphonenumber-js', () => ({
    parsePhoneNumberFromString: parseMock,
  }));

  const mod = await import('../../utils/phone.js');
  return mod;
}

afterEach(() => {
  jest.resetModules();
  jest.restoreAllMocks();
});

describe('phone utils', () => {
  test('toE164: US local number uses defaultCountry and formats to +E.164', async () => {
    const parseMock = makeParseMock();
    const { toE164 } = await loadPhoneModuleWithMock(parseMock);

    // "4155552671" with defaultCountry 'US' should map to +14155552671
    const out = toE164('4155552671', 'US');
    expect(out).toBe(DUMMY_US_E164);

    // It should have called parsePhoneNumberFromString with (number, 'US')
    expect(parseMock).toHaveBeenCalledWith('4155552671', 'US');

    // Also support messy formatting like "(415) 555-2671"
    const out2 = toE164('(415) 555-2671', 'US');
    expect(out2).toBe(DUMMY_US_E164);
  });

  test('toE164: numbers starting with "+" bypass region and are returned directly if valid', async () => {
    const parseMock = makeParseMock();
    const { toE164 } = await loadPhoneModuleWithMock(parseMock);

    // when number starts with +, we call parsePhoneNumberFromString(s) without region arg
    const out = toE164('+14155552671', 'US'); // region should be ignored
    expect(out).toBe(DUMMY_US_E164);

    // first call should have had just the string, no defaultCountry
    expect(parseMock).toHaveBeenCalledWith('+14155552671');
  });

  test('toE164: custom defaultCountry works (GB example)', async () => {
    const parseMock = makeParseMock();
    const { toE164 } = await loadPhoneModuleWithMock(parseMock);

    const out = toE164('07700900123', 'GB');
    expect(out).toBe(DUMMY_GB_E164);

    // parsed with region 'GB'
    expect(parseMock).toHaveBeenCalledWith('07700900123', 'GB');
  });

  test('toE164: returns null for invalid or unparsable input', async () => {
    const parseMock = makeParseMock();
    const { toE164 } = await loadPhoneModuleWithMock(parseMock);

    // invalid string that parse returns { isValid:false }
    const out1 = toE164('123', 'US');
    expect(out1).toBeNull();

    // totally nonsense that parse returns null
    const out2 = toE164('not a phone', 'US');
    expect(out2).toBeNull();

    // empty-ish input
    const out3 = toE164('', 'US');
    expect(out3).toBeNull();
    const out4 = toE164(null, 'US');
    expect(out4).toBeNull();
  });

  test('digitsOnly strips all non-digits and tolerates undefined', async () => {
    const parseMock = makeParseMock();
    const { digitsOnly } = await loadPhoneModuleWithMock(parseMock);

    expect(digitsOnly('(415) 555-2671')).toBe('4155552671');
    expect(digitsOnly('+44 7700 900123')).toBe('447700900123');
    expect(digitsOnly('abc123xyz')).toBe('123');
    expect(digitsOnly()).toBe('');
  });

  test('normalizeE164 is just an alias to toE164 (US default)', async () => {
    const parseMock = makeParseMock();
    const { normalizeE164, toE164 } = await loadPhoneModuleWithMock(parseMock);

    const raw = '4155552671';

    const a = normalizeE164(raw); // defaultCountry should default to 'US'
    const b = toE164(raw, 'US');

    expect(a).toBe(b);
    expect(a).toBe(DUMMY_US_E164);
  });

  test('isE164 returns true/false based on successful toE164 parse', async () => {
    const parseMock = makeParseMock();
    const { isE164 } = await loadPhoneModuleWithMock(parseMock);

    expect(isE164('4155552671', 'US')).toBe(true);
    expect(isE164('+14155552671')).toBe(true);

    expect(isE164('not a phone', 'US')).toBe(false);
    expect(isE164('123', 'US')).toBe(false);
    expect(isE164('', 'US')).toBe(false);
  });
});
