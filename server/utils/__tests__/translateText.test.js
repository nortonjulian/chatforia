import { jest } from '@jest/globals';

// We'll be doing dynamic imports because translateText.js captures env,
// creates cache, etc. at module load.
// Strategy per test:
//   1. tweak process.env
//   2. jest.resetModules()
//   3. mock dependencies with jest.unstable_mockModule
//   4. import translateText.js with `await import(...)`
//   5. run assertions

const ORIGINAL_ENV = { ...process.env };

// We'll build lightweight fake LRU + asyncPool we control in every test.
function createFakeLRU() {
  const store = new Map();
  return {
    has: (key) => store.has(key),
    get: (key) => store.get(key),
    set: (key, val /* ttl */) => {
      store.set(key, val);
    },
    _dump() {
      return new Map(store);
    },
  };
}

// We'll capture the "store" for inspection.
let lastLRUInstance;
let asyncPoolCalls;

// helper to set up mocks + import fresh module
async function loadModuleWithEnv({
  deeplKey,
  openaiKey,
  ttlMs,
  cacheSize,
  fanoutConcurrency,
} = {}) {
  process.env = { ...ORIGINAL_ENV }; // start from clean
  if (deeplKey !== undefined) process.env.DEEPL_API_KEY = deeplKey;
  if (openaiKey !== undefined) process.env.OPENAI_API_KEY = openaiKey;
  if (ttlMs !== undefined) process.env.TRANSLATE_CACHE_TTL_MS = String(ttlMs);
  if (cacheSize !== undefined)
    process.env.TRANSLATE_CACHE_SIZE = String(cacheSize);
  if (fanoutConcurrency !== undefined)
    process.env.TRANSLATE_FANOUT_CONCURRENCY = String(fanoutConcurrency);

  asyncPoolCalls = [];

  // mock LRU and asyncPool before import
  jest.resetModules();

  jest.unstable_mockModule('../../utils/lru.js', () => ({
    LRU: class FakeLRU {
      constructor() {
        lastLRUInstance = createFakeLRU();
        return lastLRUInstance;
      }
    },
  }));

  jest.unstable_mockModule('../../utils/asyncPool.js', () => ({
    asyncPool: async (concurrency, items, worker) => {
      // record invocation
      asyncPoolCalls.push({ concurrency, items: [...items] });
      // run workers sequentially in test to keep it simple
      for (const it of items) {
        await worker(it);
      }
      return;
    },
  }));

  // mock global fetch. We'll replace it per test as needed.
  global.fetch = jest.fn();

  // now import module under test
  const mod = await import('../../utils/translateText.js');
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
    });

    // No text
    await expect(
      translateText({ text: '', targetLang: 'es' })
    ).rejects.toThrow(/text and targetLang required/i);

    // No targetLang
    await expect(
      translateText({ text: 'hello', targetLang: '' })
    ).rejects.toThrow(/text and targetLang required/i);
  });

  test('uses DeepL when DEEPL_API_KEY is set, returns provider "deepl", caches result', async () => {
    // Arrange: we have DeepL and we want fetch() to mimic DeepL API
    const { translateText } = await loadModuleWithEnv({
      deeplKey: 'DEEPL_KEY_PRESENT',
      openaiKey: undefined,
    });

    // our fake DeepL response
    global.fetch.mockImplementation(async (url, _opts) => {
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

    // Confirm cache got set
    const key = 'v1|en|es|hello world';
    expect(lastLRUInstance.has(key)).toBe(true);
    expect(lastLRUInstance.get(key)).toBe('hola mundo');
  });

  test('falls back to OpenAI if DeepL throws AND OPENAI key exists', async () => {
    const { translateText } = await loadModuleWithEnv({
      deeplKey: 'DEEPL_KEY_PRESENT',
      openaiKey: 'OPENAI_KEY_PRESENT',
    });

    // Simulate DeepL failing first
    global.fetch.mockImplementation(async (url, _opts) => {
      if (url.includes('deepl.com')) {
        return {
          ok: false,
          status: 500,
          text: async () => 'DeepL exploded',
        };
      }
      if (url.includes('openai.com')) {
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

    const key = 'v1|en|es|hello world';
    expect(lastLRUInstance.get(key)).toBe('hola mundo (openai)');
  });

  test('uses OpenAI directly if only OPENAI key is set', async () => {
    const { translateText } = await loadModuleWithEnv({
      deeplKey: undefined,
      openaiKey: 'OPENAI_KEY_PRESENT',
    });

    global.fetch.mockImplementation(async (url, _opts) => {
      if (url.includes('openai.com')) {
        return {
          ok: true,
          json: async () => ({
            choices: [
              { message: { content: 'bonjour le monde' } },
            ],
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
    });

    // fetch should never be called in noop mode
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

    const key = 'v1|en|de|hello world';
    expect(lastLRUInstance.get(key)).toBe('hello world');
  });

  test('cache hit returns provider "cache" and does NOT call fetch again', async () => {
    const { translateText } = await loadModuleWithEnv({
      deeplKey: undefined,
      openaiKey: undefined,
    });

    // 1st call: prime the cache (noop provider)
    await translateText({
      text: 'hi',
      targetLang: 'it',
      sourceLang: 'en',
    });

    expect(global.fetch).not.toHaveBeenCalled();
    const key = 'v1|en|it|hi';
    expect(lastLRUInstance.get(key)).toBe('hi');

    global.fetch.mockClear();

    // 2nd call: should be served purely from cache
    const res2 = await translateText({
      text: 'hi',
      targetLang: 'it',
      sourceLang: 'en',
    });

    expect(res2.provider).toBe('cache');
    expect(res2.translatedText).toBe('hi');
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test('extraTargets triggers asyncPool fanout with bounded concurrency and warms cache for other langs', async () => {
    const { translateText } = await loadModuleWithEnv({
      deeplKey: undefined,
      openaiKey: undefined,
      fanoutConcurrency: 3,
    });

    // noop mode again
    global.fetch.mockImplementation(async () => {
      throw new Error('fetch should not have been called');
    });

    const res = await translateText({
      text: 'hello crew',
      targetLang: 'es',
      sourceLang: 'en',
      extraTargets: ['fr', 'de', 'es', 'fr'], // duplicates and primary
    });

    // primary result
    expect(res.provider).toBe('noop');
    expect(res.translatedText).toBe('hello crew');
    expect(res.targetLang).toBe('es');

    // asyncPool should have been called once
    expect(asyncPoolCalls.length).toBe(1);
    const fan = asyncPoolCalls[0];

    // concurrency should match env TRANSLATE_FANOUT_CONCURRENCY (3)
    expect(fan.concurrency).toBe(3);

    // uniqueExtras logic => ['fr','de']
    expect(fan.items).toEqual(['fr', 'de']);

    // cache warmed for 'fr' and 'de'
    const kFr = 'v1|en|fr|hello crew';
    const kDe = 'v1|en|de|hello crew';
    expect(lastLRUInstance.get(kFr)).toBe('hello crew');
    expect(lastLRUInstance.get(kDe)).toBe('hello crew');
  });
});
