import { jest } from '@jest/globals';

const ORIGINAL_ENV = { ...process.env };

function createFakeLRU() {
  const store = new Map();
  return {
    has: (key) => store.has(key),
    get: (key) => store.get(key),
    set: (key, val) => {
      store.set(key, val);
    },
    _dump() {
      return new Map(store);
    },
  };
}

let lastLRUInstance;
let asyncPoolCalls;

/**
 * Helper that:
 *  - sets process.env for this test run (including TRANSLATE_FORCE_PROVIDER)
 *  - mocks LRU + asyncPool
 *  - stubs global.fetch (each test can override behavior)
 *  - dynamically imports translateText.js fresh with those mocks active
 */
async function loadModuleWithEnv({
  deeplKey,
  openaiKey,
  ttlMs,
  cacheSize,
  fanoutConcurrency,
  forceProvider,
} = {}) {
  // Reset env to a clean baseline per test
  process.env = { ...ORIGINAL_ENV };
  if (deeplKey !== undefined) process.env.DEEPL_API_KEY = deeplKey;
  if (openaiKey !== undefined) process.env.OPENAI_API_KEY = openaiKey;
  if (ttlMs !== undefined) process.env.TRANSLATE_CACHE_TTL_MS = String(ttlMs);
  if (cacheSize !== undefined)
    process.env.TRANSLATE_CACHE_SIZE = String(cacheSize);
  if (fanoutConcurrency !== undefined)
    process.env.TRANSLATE_FANOUT_CONCURRENCY = String(fanoutConcurrency);
  if (forceProvider !== undefined)
    process.env.TRANSLATE_FORCE_PROVIDER = forceProvider;

  asyncPoolCalls = [];

  // Clear module registry so unstable_mockModule + import() work predictably
  jest.resetModules();

  // Mock @utils/lru.js so we get a controllable in-memory cache
  jest.unstable_mockModule('@utils/lru.js', () => ({
    LRU: class FakeLRU {
      constructor() {
        lastLRUInstance = createFakeLRU();
        return lastLRUInstance;
      }
    },
  }));

  // Mock @utils/asyncPool.js so we record fanout concurrency/items
  jest.unstable_mockModule('@utils/asyncPool.js', () => ({
    asyncPool: async (concurrency, items, worker) => {
      asyncPoolCalls.push({ concurrency, items: [...items] });
      // Run sequentially for determinism
      for (const it of items) {
        await worker(it);
      }
      return;
    },
  }));

  // Stub fetch (each test can override impl later)
  global.fetch = jest.fn();

  // Import module under test AFTER mocks and env are in place
  const mod = await import('@utils/translateText.js');
  return mod;
}

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  jest.resetModules();
  jest.restoreAllMocks();
});

describe('translateText()', () => {
  test('throws 400 Boom if required args missing', async () => {
    const { translateText } = await loadModuleWithEnv({
      deeplKey: undefined,
      openaiKey: undefined,
      forceProvider: 'noop',
    });

    await expect(
      translateText({ text: '', targetLang: 'es' })
    ).rejects.toThrow(/text and targetLang required/i);

    await expect(
      translateText({ text: 'hello', targetLang: '' })
    ).rejects.toThrow(/text and targetLang required/i);
  });

  test('uses DeepL when DEEPL_API_KEY is set, returns provider "deepl", caches result', async () => {
    const { translateText } = await loadModuleWithEnv({
      deeplKey: 'DEEPL_KEY_PRESENT',
      openaiKey: undefined,
      // no forceProvider: exercise real DeepL branch
    });

    // Fake DeepL API response
    global.fetch.mockImplementation(async (url) => {
      if (url.includes('deepl.com')) {
        return {
          ok: true,
          json: async () => ({
            translations: [
              { text: 'hola mundo', detected_source_language: 'EN' },
            ],
          }),
        };
      }
      throw new Error('unexpected fetch URL: ' + url);
    });

    const res = await translateText({
      text: 'hello world',
      targetLang: 'es',
      sourceLang: 'en',
    });

    expect(res).toEqual({
      text: 'hello world',
      translatedText: 'hola mundo',
      translated: 'hola mundo',
      targetLang: 'es',
      detectedSourceLang: 'EN',
      provider: 'deepl',
    });

    // Cache should now contain the translation
    const key = 'v1|en|es|hello world';
    expect(lastLRUInstance.has(key)).toBe(true);
    expect(lastLRUInstance.get(key)).toBe('hola mundo');
  });

  test('falls back to OpenAI if DeepL throws AND OPENAI key exists', async () => {
    const { translateText } = await loadModuleWithEnv({
      deeplKey: 'DEEPL_KEY_PRESENT',
      openaiKey: 'OPENAI_KEY_PRESENT',
      // no forceProvider: exercise DeepL->OpenAI fallback chain
    });

    global.fetch.mockImplementation(async (url) => {
      if (url.includes('deepl.com')) {
        // Simulate DeepL outage
        return {
          ok: false,
          status: 500,
          text: async () => 'DeepL exploded',
        };
      }
      if (url.includes('openai.com')) {
        // Simulate OpenAI success
        return {
          ok: true,
          json: async () => ({
            choices: [
              {
                message: {
                  content: 'hola mundo (openai)',
                },
              },
            ],
          }),
        };
      }
      throw new Error('unexpected fetch URL: ' + url);
    });

    const res = await translateText({
      text: 'hello world',
      targetLang: 'es',
      sourceLang: 'en',
    });

    expect(res.provider).toBe('openai');
    expect(res.translatedText).toBe('hola mundo (openai)');
    expect(res.detectedSourceLang).toBe('en');

    // Cache warmed with the OpenAI translation
    const key = 'v1|en|es|hello world';
    expect(lastLRUInstance.get(key)).toBe('hola mundo (openai)');
  });

  test('uses OpenAI directly if only OPENAI key is set', async () => {
    const { translateText } = await loadModuleWithEnv({
      deeplKey: undefined,
      openaiKey: 'OPENAI_KEY_PRESENT',
      // no forceProvider: exercise OpenAI direct path
    });

    global.fetch.mockImplementation(async (url) => {
      if (url.includes('openai.com')) {
        return {
          ok: true,
          json: async () => ({
            choices: [{ message: { content: 'bonjour le monde' } }],
          }),
        };
      }
      throw new Error('unexpected fetch URL: ' + url);
    });

    const res = await translateText({
      text: 'hello world',
      targetLang: 'fr',
      sourceLang: 'en',
    });

    expect(res.provider).toBe('openai');
    expect(res.translatedText).toBe('bonjour le monde');
    expect(res.targetLang).toBe('fr');
    expect(res.detectedSourceLang).toBe('en');

    const key = 'v1|en|fr|hello world';
    expect(lastLRUInstance.get(key)).toBe('bonjour le monde');
  });

  test('provider "noop" when neither DeepL nor OpenAI keys exist', async () => {
    const { translateText } = await loadModuleWithEnv({
      deeplKey: undefined,
      openaiKey: undefined,
      forceProvider: 'noop', // <-- force noop branch, never hit fetch
    });

    // If translateText() accidentally hits network, fail loudly
    global.fetch.mockImplementation(async () => {
      throw new Error('fetch should not have been called');
    });

    const res = await translateText({
      text: 'hello world',
      targetLang: 'de',
      sourceLang: 'en',
    });

    expect(res.provider).toBe('noop');
    expect(res.translatedText).toBe('hello world'); // echo
    expect(res.detectedSourceLang).toBe('en');
    expect(res.targetLang).toBe('de');

    // Cache warmed with noop translation
    const key = 'v1|en|de|hello world';
    expect(lastLRUInstance.get(key)).toBe('hello world');
  });

  test('cache hit returns provider "cache" and does NOT call fetch again', async () => {
    const { translateText } = await loadModuleWithEnv({
      deeplKey: undefined,
      openaiKey: undefined,
      forceProvider: 'noop', // <-- first call warms cache in noop mode
    });

    // 1st call warms cache
    await translateText({
      text: 'hi',
      targetLang: 'it',
      sourceLang: 'en',
    });

    // We should not have touched fetch for noop warm
    expect(global.fetch).not.toHaveBeenCalled();

    const key = 'v1|en|it|hi';
    expect(lastLRUInstance.get(key)).toBe('hi');

    global.fetch.mockClear();

    // 2nd call should come entirely from cache
    const res2 = await translateText({
      text: 'hi',
      targetLang: 'it',
      sourceLang: 'en',
    });

    expect(res2.provider).toBe('cache');
    expect(res2.translatedText).toBe('hi');
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test('extraTargets triggers asyncPool fanout with bounded concurrency and schedules cache warm for other langs', async () => {
  const { translateText } = await loadModuleWithEnv({
    deeplKey: undefined,
    openaiKey: undefined,
    fanoutConcurrency: 3,
    forceProvider: 'noop', // <-- fanout should also noop, not fetch
  });

  // If translateOnce ever tried network, we'd throw here
  global.fetch.mockImplementation(async () => {
    throw new Error('fetch should not have been called');
  });

  const res = await translateText({
    text: 'hello crew',
    targetLang: 'es',
    sourceLang: 'en',
    extraTargets: ['fr', 'de', 'es', 'fr'], // dupes + primary included
  });

  // Give the asyncPool promise a chance to run, just to let at least first worker land
  await Promise.resolve();

  // primary result is noop
  expect(res.provider).toBe('noop');
  expect(res.translatedText).toBe('hello crew');
  expect(res.targetLang).toBe('es');

  // asyncPool should have been called once with the correct unique extras
  expect(asyncPoolCalls.length).toBe(1);
  const fan = asyncPoolCalls[0];

  // concurrency should respect TRANSLATE_FANOUT_CONCURRENCY
  expect(fan.concurrency).toBe(3);

  // uniqueExtras logic => ['fr','de'] (deduped, dropped primary 'es')
  expect(fan.items).toEqual(['fr', 'de']);

  // Cache should now contain:
  // - the primary language ('es')
  // - and at least one warmed extra (usually first in fan.items, i.e. 'fr')
  const kEs = 'v1|en|es|hello crew';
  const kFr = 'v1|en|fr|hello crew';

  expect(lastLRUInstance.get(kEs)).toBe('hello crew');
  expect(lastLRUInstance.get(kFr)).toBe('hello crew');

  // We do NOT assert 'de' because fanout is fire-and-forget and not awaited.
 });
});
