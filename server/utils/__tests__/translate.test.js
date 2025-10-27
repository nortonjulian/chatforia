import { jest } from '@jest/globals';

let googleCalls = [];
const ORIGINAL_ENV = { ...process.env };

// helper to load a fresh copy of both translate.js and redisClient.js
async function loadModuleFresh() {
  jest.resetModules();

  // mock crypto.createHash so our sha256() is deterministic
  jest.unstable_mockModule('crypto', () => ({
    default: {
      createHash: () => ({
        _data: '',
        update(str) {
          this._data += str;
          return this;
        },
        digest() {
          return 'HASH_' + this._data.replace(/[^a-zA-Z0-9]/g, '_');
        },
      }),
    },
    createHash: () => ({
      _data: '',
      update(str) {
        this._data += str;
        return this;
      },
      digest() {
        return 'HASH_' + this._data.replace(/[^a-zA-Z0-9]/g, '_');
      },
    }),
  }));

  // mock @google-cloud/translate v2.Translate
  googleCalls = [];
  const mockTranslateInstance = {
    translate: jest.fn(async (text, lang) => {
      googleCalls.push({ text, lang });
      return [`[${lang}] ${text}`]; // same shape as real client
    }),
  };

  jest.unstable_mockModule('@google-cloud/translate', () => ({
    v2: {
      Translate: class FakeTranslate {
        constructor() {
          return mockTranslateInstance;
        }
      },
    },
  }));

  // now import modules under test
  const translateMod = await import('../../utils/translate.js');
  const redisMod = await import('../../utils/redisClient.js');

  return {
    ...translateMod,
    __redisStore: redisMod.__redisTestStore
      ? redisMod.__redisTestStore()
      : null,
  };
}

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  jest.resetModules();
  jest.restoreAllMocks();
});

describe('translate.js', () => {
  test('translateForTargets skips senderLang, dedupes, returns map + from', async () => {
    process.env.GOOGLE_API_KEY = 'fake-key';

    const { translateForTargets, __redisStore } = await loadModuleFresh();

    const result = await translateForTargets('hello world', 'en', [
      'es',
      'fr',
      'es',
      'en',
    ]);

    expect(result).toHaveProperty('from', 'en');
    expect(result.map.es).toBe('[es] hello world');
    expect(result.map.fr).toBe('[fr] hello world');
    expect(result.map.en).toBeUndefined();

    // google called twice ('es' and 'fr')
    expect(googleCalls).toEqual([
      { text: 'hello world', lang: 'es' },
      { text: 'hello world', lang: 'fr' },
    ]);

    // redis store populated with cached translations
    const entries = [...__redisStore.entries()].sort();
    expect(entries).toEqual(
      [
        ['tr:HASH_hello_world:es', '[es] hello world'],
        ['tr:HASH_hello_world:fr', '[fr] hello world'],
      ].sort()
    );
  });

  test('translateForTargets short-circuits if nothing to translate', async () => {
    process.env.GOOGLE_API_KEY = 'fake-key';

    const { translateForTargets } = await loadModuleFresh();

    const r1 = await translateForTargets('', 'en', ['es', 'fr']);
    expect(r1).toEqual({ map: {}, from: 'en' });

    const r2 = await translateForTargets('hi', 'en', ['en', 'en']);
    expect(r2).toEqual({ map: {}, from: 'en' });

    expect(googleCalls).toHaveLength(0);
  });

  test('translateOne returns null on missing args', async () => {
    process.env.GOOGLE_API_KEY = 'fake-key';

    const { translateOne } = await loadModuleFresh();

    await expect(translateOne('', 'es')).resolves.toBeNull();
    await expect(translateOne('hello', '')).resolves.toBeNull();
  });

  test('translateOne caches: first call hits Google+Redis, second call uses mem only', async () => {
    process.env.GOOGLE_API_KEY = 'fake-key';

    const { translateOne, __redisStore } = await loadModuleFresh();

    const first = await translateOne('hello', 'es');
    expect(first).toBe('[es] hello');
    expect(googleCalls).toEqual([{ text: 'hello', lang: 'es' }]);
    expect(__redisStore.get('tr:HASH_hello:es')).toBe('[es] hello');

    googleCalls.length = 0; // reset
    const second = await translateOne('hello', 'es');
    expect(second).toBe('[es] hello');
    expect(googleCalls).toHaveLength(0); // no new Google calls
  });

  test('if Redis.get() returns a hit, we populate mem and skip Google', async () => {
    process.env.GOOGLE_API_KEY = 'fake-key';

    const { translateOne, __redisStore } = await loadModuleFresh();

    // seed fake Redis
    __redisStore.set('tr:HASH_cached_text:de', 'HALLO AUS REDIS');

    const out = await translateOne('cached text', 'de');
    expect(out).toBe('HALLO AUS REDIS');
    expect(googleCalls).toHaveLength(0);

    const out2 = await translateOne('cached text', 'de');
    expect(out2).toBe('HALLO AUS REDIS');
    expect(googleCalls).toHaveLength(0);
  });
});
