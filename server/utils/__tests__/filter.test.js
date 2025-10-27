import { jest } from '@jest/globals';

afterEach(() => {
  // clean up mocks/stubs between tests
  jest.restoreAllMocks();
  jest.resetModules(); // ensure next dynamic import sees a clean slate
});

// We'll mock bad-words-next before importing the module under test.
// Our mock will treat any string containing "badword" (case-insensitive)
// as explicit. It will censor "badword" -> "*******".
async function loadFilterModuleWithMock() {
  // reset module registry so import() below will re-execute with our mock
  jest.resetModules();

  const checkMock = jest.fn((text) => {
    if (!text) return [];
    return /badword/i.test(text) ? ['badword'] : [];
  });

  const filterMock = jest.fn((text) => {
    if (!text) return text;
    // replace all instances of "badword" (case-insensitive) with "*******"
    return text.replace(/badword/gi, '*******');
  });

  class FakeBadWords {
    constructor() {}
    check(txt) {
      return checkMock(txt);
    }
    filter(txt) {
      return filterMock(txt);
    }
  }

  // mock the external dependency before importing the SUT
  jest.unstable_mockModule('bad-words-next', () => ({
    default: FakeBadWords,
  }));

  // now import the module-under-test fresh, *after* mocking
  const mod = await import('../../utils/filter.js');

  return {
    mod,
    checkMock,
    filterMock,
  };
}

describe('filter utils', () => {
  test('isExplicit() returns true when profanity is detected and false when clean', async () => {
    const { mod, checkMock } = await loadFilterModuleWithMock();
    const { isExplicit } = mod;

    // Clean text
    expect(isExplicit('hello there')).toBe(false);

    // Explicit text
    expect(isExplicit('you are a BADWORD')).toBe(true);

    // Make sure it called the underlying check() with the provided strings
    expect(checkMock).toHaveBeenCalledWith('hello there');
    expect(checkMock).toHaveBeenCalledWith('you are a BADWORD');
  });

  test('cleanText() (strict=false) censors only the profane words and leaves clean text unchanged', async () => {
    const { mod, filterMock } = await loadFilterModuleWithMock();
    const { cleanText } = mod;

    // Clean text returns same string
    const clean = cleanText('nice polite message');
    expect(clean).toBe('nice polite message');

    // Explicit text gets censored via filter.filter(...)
    const rude = cleanText('wow such badword energy');
    expect(rude).toBe('wow such ******* energy');

    // Assert we ran through filterMock
    expect(filterMock).toHaveBeenCalledWith('nice polite message');
    expect(filterMock).toHaveBeenCalledWith('wow such badword energy');
  });

  test('cleanText() with strict=true nukes the whole message if explicit, otherwise passes original through', async () => {
    const { mod } = await loadFilterModuleWithMock();
    const { cleanText } = mod;

    // Non-explicit strict mode → original text
    const mild = cleanText('have a great day', true);
    expect(mild).toBe('have a great day');

    // Explicit strict mode → full replacement warning
    const nuked = cleanText('this is BADWORD level toxic', true);
    expect(nuked).toBe('[Message removed due to explicit content]');
  });

  test('cleanText() strict=false still returns something usable when text is empty/undefined', async () => {
    const { mod } = await loadFilterModuleWithMock();
    const { cleanText } = mod;

    expect(cleanText('')).toBe(''); // stays empty
    expect(cleanText(undefined)).toBeUndefined(); // passes through
  });

  test('isExplicit() handles empty/undefined safely', async () => {
    const { mod } = await loadFilterModuleWithMock();
    const { isExplicit } = mod;

    expect(isExplicit('')).toBe(false);
    expect(isExplicit(undefined)).toBe(false);
  });
});
