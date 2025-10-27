// We are going to:
// - mock crypto.createHash so sha256() is deterministic
// - mock @google-cloud/translate v2 client
// - mock ensureRedis() so we control Redis get/setEx
// - dynamically import translate.js after mocks are in place

let googleCalls = [];
let redisStore;
let ensureRedisMock;
let mockTranslateInstance;

const ORIGINAL_ENV = { ...process.env };

function setupRedisMock() {
  redisStore = new Map();

  ensureRedisMock = jest.fn(async () => {
    return {
      get: jest.fn(async (key) => {
        return redisStore.get(key) ?? null;
      }),
      setEx: jest.fn(async (key, ttlSec, value) => {
        redisStore.set(key, value);
      }),
    };
  });
}

async function loadModuleFresh() {
  jest.resetModules();

  // 1. mock crypto
  jest.unstable_mockModule('crypto', () => ({
    default: {
      createHash: (algo) => ({
        _data: '',
        update(str) {
          this._data += str;
          return this;
        },
        digest() {
          // super predictable hash: "HASH_" + content_with_underscores
          return (
            'HASH_' + this._data.replace(/[^a-zA-Z0-9]/g, '_')
          );
        },
      }),
    },
    createHash: (algo) => ({
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

  // 2. mock @google-cloud/translate v2
  googleCalls = [];
  mockTranslateInstance = {
    translate: jest.fn(async (text, lang) => {
      // record calls so we can assert usage
      googleCalls.push({ text, lang });
      // return [translatedText] just like the real API does
      return [`[${lang}] ${text}`];
    }),
  };

  jest.unstable_mockModule('@google-cloud/translate', () => ({
    v2: {
      Translate: class FakeTranslate {
        constructor(opts) {
          // we don't care about opts.key for tests
          return mockTranslateInstance;
        }
      },
    },
  }));

  // 3. mock ensureRedis()
  setupRedisMock();
  jest.unstable_mockModule('../../utils/redisClient.js', () => ({
    ensureRedis: ensureRedisMock,
  }));

  // now import the module under test
  const mod = await import('../../utils/translate.js');
  return mod;
}

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  jest.resetModules();
  jest.restoreAllMocks();
});

describe('translate.js', () => {
  test('translateForTargets skips senderLang, dedupes, and returns map + from', async () => {
    process.env.GOOGLE_API_KEY = 'fake-key';

    const { translateForTargets } = await loadModuleFresh();

    // We will translate "hello world" from 'en' to ['es','fr','es','en']
    // Rules:
    //   - remove duplicates → ['es','fr','en']
    //   - skip senderLang 'en' → ['es','fr']
    // So we expect translations for 'es' and 'fr' only.
    const result = await translateForTargets('hello world', 'en', [
      'es',
      'fr',
      'es',
      'en',
    ]);

    // shape
    expect(result).toHaveProperty('map');
    expect(result).toHaveProperty('from', 'en');

    // map should have es and fr translations, each like "[lang] text"
    expect(result.map['es']).toBe('[es] hello world');
    expect(result.map['fr']).toBe('[fr] hello world');
    expect(result.map['en']).toBeUndefined();

    // Google should have been called exactly twice
    expect(googleCalls).toEqual([
      { text: 'hello world', lang: 'es' },
      { text: 'hello world', lang: 'fr' },
    ]);

    // Redis setEx should have been called for each translation (write-through)
    // ensureRedis() is called lazily inside translateWithCache twice, so 2 calls total (or maybe more, but at least >=1)
    expect(ensureRedisMock).toHaveBeenCalled();
    // redisStore should now contain both cached values
    // Keys look like: tr:<sha256(text)>:<lang>
    // Our sha256 mock returns "HASH_hello_world" for text "hello world"
    expect([...redisStore.entries()].sort()).toEqual(
      [
        [`tr:HASH_hello_world:es`, '[es] hello world'],
        [`tr:HASH_hello_world:fr`, '[fr] hello world'],
      ].sort()
    );
  });

  test('translateForTargets short-circuits if no translatable targets', async () => {
    process.env.GOOGLE_API_KEY = 'fake-key';

    const { translateForTargets } = await loadModuleFresh();

    // Case 1: empty content
    const r1 = await translateForTargets('', 'en', ['es', 'fr']);
    expect(r1).toEqual({ map: {}, from: 'en' });

    // Case 2: targets only include senderLang
    const r2 = await translateForTargets('hi', 'en', ['en', 'en']);
    expect(r2).toEqual({ map: {}, from: 'en' });

    // Should not actually call Google at all
    expect(googleCalls).toHaveLength(0);
  });

  test('translateOne returns null on missing args', async () => {
    process.env.GOOGLE_API_KEY = 'fake-key';

    const { translateOne } = await loadModuleFresh();

    await expect(translateOne('', 'es')).resolves.toBeNull();
    await expect(translateOne('hello', '')).resolves.toBeNull();
  });

  test('translateOne uses cache: first call hits Google+Redis, second call is served from mem (no new Google call)', async () => {
    process.env.GOOGLE_API_KEY = 'fake-key';

    const { translateOne } = await loadModuleFresh();

    // First call -> no cache, so:
    //   - sha256 -> key "tr:HASH_hello:es"
    //   - check mem -> miss
    //   - check redis -> miss
    //   - call Google translate -> "[es] hello"
    //   - write mem, write redis
    const first = await translateOne('hello', 'es');
    expect(first).toBe('[es] hello');

    expect(googleCalls).toEqual([{ text: 'hello', lang: 'es' }]);
    expect(redisStore.get('tr:HASH_hello:es')).toBe('[es] hello');

    // Now simulate a fresh second call in same module instance.
    // Redis *would* still have it, but importantly mem cache should hit first,
    // so we should NOT call Google translate again.
    googleCalls.length = 0; // reset capture

    const second = await translateOne('hello', 'es');
    expect(second).toBe('[es] hello');

    // no new Google calls after cache hit
    expect(googleCalls).toHaveLength(0);
  });

  test('if Redis.get() returns a hit, we still populate mem and skip Google', async () => {
    process.env.GOOGLE_API_KEY = 'fake-key';

    const { translateOne } = await loadModuleFresh();

    // Pre-seed Redis store with an entry, like this is a cached previous translation.
    // Key format: tr:<sha256(text)>:<lang>
    redisStore.set('tr:HASH_cached_text:de', 'HALLO AUS REDIS');

    // Ask translateOne for that same thing.
    const out = await translateOne('cached text', 'de');
    expect(out).toBe('HALLO AUS REDIS');

    // Should NOT hit Google, because redis hit short-circuits
    expect(googleCalls).toHaveLength(0);

    // Next call again, should now come straight from in-memory mem cache
    const out2 = await translateOne('cached text', 'de');
    expect(out2).toBe('HALLO AUS REDIS');
    expect(googleCalls).toHaveLength(0);
  });
});
