const ORIGINAL_ENV = process.env;

const reload = async (env = {}, now = 0) => {
  jest.resetModules();
  process.env = { ...ORIGINAL_ENV, ...env };
  jest.spyOn(Date, 'now').mockReturnValue(now);
  return import('../cache.js');
};

afterAll(() => {
  process.env = ORIGINAL_ENV;
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('translation cache', () => {
  test('disabled when TRANSLATION_CACHE_TTL_SECONDS is 0/undefined', async () => {
    // TTL unset -> treated as 0 (disabled)
    let mod = await reload({ TRANSLATION_CACHE_TTL_SECONDS: '' }, 1000);
    expect(mod.getCached('k')).toBeNull();
    expect(() => mod.setCached('k', 'v')).not.toThrow();
    expect(mod.getCached('k')).toBeNull();

    // TTL explicitly 0 -> disabled
    mod = await reload({ TRANSLATION_CACHE_TTL_SECONDS: '0' }, 1000);
    mod.setCached('x', 'y');
    expect(mod.getCached('x')).toBeNull();
  });

  test('set/get within TTL, then expire after TTL', async () => {
    const TTL = 60; // seconds
    let now = 1_000_000; // ms
    jest.spyOn(Date, 'now').mockReturnValue(now);
    const mod = await reload({ TRANSLATION_CACHE_TTL_SECONDS: String(TTL) }, now);

    mod.setCached('hello|es', 'hola');
    expect(mod.getCached('hello|es')).toBe('hola'); // before expiry

    // Advance to just before expiry
    now += (TTL * 1000) - 1;
    Date.now.mockReturnValue(now);
    expect(mod.getCached('hello|es')).toBe('hola');

    // Advance past expiry
    now += 2;
    Date.now.mockReturnValue(now);
    expect(mod.getCached('hello|es')).toBeNull(); // expired → null (and entry dropped)
  });

  test('maxEntries eviction removes oldest entry (naive FIFO)', async () => {
    const TTL = 300; // long enough not to expire during test
    const MAX = 2;
    let now = 10_000;
    jest.spyOn(Date, 'now').mockReturnValue(now);

    const mod = await reload(
      {
        TRANSLATION_CACHE_TTL_SECONDS: String(TTL),
        TRANSLATION_CACHE_MAX: String(MAX),
      },
      now
    );

    // Insert A, B
    mod.setCached('A', 'va'); // oldest
    now += 1; Date.now.mockReturnValue(now);
    mod.setCached('B', 'vb');

    // Insert C → should evict A (oldest)
    now += 1; Date.now.mockReturnValue(now);
    mod.setCached('C', 'vc');

    // A should be gone
    expect(mod.getCached('A')).toBeNull();
    // B and C should still be present
    expect(mod.getCached('B')).toBe('vb');
    expect(mod.getCached('C')).toBe('vc');

    // Insert D → evicts B now (oldest among B,C)
    now += 1; Date.now.mockReturnValue(now);
    mod.setCached('D', 'vd');

    expect(mod.getCached('B')).toBeNull();
    expect(mod.getCached('C')).toBe('vc');
    expect(mod.getCached('D')).toBe('vd');
  });

  test('ignores falsy keys (no throw, no set)', async () => {
    const mod = await reload({ TRANSLATION_CACHE_TTL_SECONDS: '120' }, 5000);
    expect(mod.getCached('')).toBeNull();
    expect(mod.getCached(null)).toBeNull();
    expect(mod.getCached(undefined)).toBeNull();

    expect(() => mod.setCached('', 'x')).not.toThrow();
    expect(() => mod.setCached(null, 'x')).not.toThrow();
    expect(() => mod.setCached(undefined, 'x')).not.toThrow();

    expect(mod.getCached('')).toBeNull();
  });
});
