import { jest } from '@jest/globals';

const ORIGINAL_ENV = { ...process.env };

afterEach(() => {
  // restore env
  process.env = { ...ORIGINAL_ENV };

  // cleanup Jest module registry + mocks
  jest.resetModules();
  jest.restoreAllMocks();
});

/**
 * Load ../../utils/redisClient.js in "prod/dev mode":
 *  - We UNSET JEST_WORKER_ID so redisClient.js does NOT take the in-memory stub branch.
 *  - We mock `redis`'s createClient() to give us deterministic fake clients.
 *
 * Returns:
 *   {
 *     mod,                // imported ../../utils/redisClient.js
 *     mockClients,        // array of the 4 fake clients in order [pub, sub, redis, kv]
 *     createClientMock,   // jest.fn for createClient
 *     clientFactoryCalls  // array of args passed to createClient
 *   }
 */
async function loadModuleWithRedisMock({ redisUrl } = {}) {
  jest.resetModules();

  // Force redisClient.js to go down the "prod/dev" branch.
  delete process.env.JEST_WORKER_ID;

  if (redisUrl !== undefined) {
    process.env.REDIS_URL = redisUrl;
  } else {
    delete process.env.REDIS_URL;
  }

  const clientFactoryCalls = [];
  const mockClients = [];

  function makeClient(label) {
    const handlers = {};
    return {
      label,
      connect: jest.fn(async () => {
        // pretend connect succeeded
      }),
      on: jest.fn((event, cb) => {
        handlers[event] = cb;
        return undefined;
      }),
      set: jest.fn(async () => 'OK'), // redisKv.set mock
      get: jest.fn(async () => null), // redisKv.get mock
      setEx: jest.fn(async () => 'OK_EX'), // not used in these tests but mirrors node-redis API
      _handlers: handlers,
    };
  }

  // Prepare 4 fake clients to hand out: pub, sub, redis, kv
  mockClients.push(makeClient('pub'));
  mockClients.push(makeClient('sub'));
  mockClients.push(makeClient('redis'));
  mockClients.push(makeClient('kv'));

  let createCallIndex = 0;
  const createClientMock = jest.fn((opts) => {
    clientFactoryCalls.push(opts);
    const c = mockClients[createCallIndex];
    createCallIndex += 1;
    return c;
  });

  // Mock the 'redis' package BEFORE importing redisClient.js
  jest.unstable_mockModule('redis', () => ({
    createClient: createClientMock,
  }));

  // Now import the module-under-test fresh with these mocks / env
  const mod = await import('../../utils/redisClient.js');

  return {
    mod,
    mockClients,
    createClientMock,
    clientFactoryCalls,
  };
}

describe('redisClient.js (prod/dev branch behavior)', () => {
  test('creates four Redis clients with the correct URL and attaches error handlers', async () => {
    const {
      mockClients,
      createClientMock,
      clientFactoryCalls,
      mod,
    } = await loadModuleWithRedisMock({
      redisUrl: 'redis://example:9999',
    });

    // We should have created 4 clients
    expect(createClientMock).toHaveBeenCalledTimes(4);

    // Each call uses the same URL we set in REDIS_URL
    expect(clientFactoryCalls).toEqual([
      { url: 'redis://example:9999' }, // redisPub
      { url: 'redis://example:9999' }, // redisSub
      { url: 'redis://example:9999' }, // redis
      { url: 'redis://example:9999' }, // redisKv
    ]);

    // Module exports should point to those 4 mocks
    expect(mod.redisPub).toBe(mockClients[0]);
    expect(mod.redisSub).toBe(mockClients[1]);
    expect(mod.redis).toBe(mockClients[2]);
    expect(mod.redisKv).toBe(mockClients[3]);

    // During module init, we attach .on('error', ...) to each client
    for (const c of mockClients) {
      expect(c.on).toHaveBeenCalledWith('error', expect.any(Function));

      // Sanity-check the handler logs to console.error with the expected shape.
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
      const handler = c._handlers['error'];
      handler && handler(new Error('boom'));
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringMatching(/^Redis client \d+ error:/),
        expect.any(Error)
      );
      consoleSpy.mockRestore();
    }
  });

  test('ensureRedis() connects all clients once, caches readiness, and returns redisKv', async () => {
    const { mod, mockClients } = await loadModuleWithRedisMock({
      redisUrl: 'redis://localtest:6379',
    });

    const { ensureRedis } = mod;

    // First call: should connect() all four clients once
    const out1 = await ensureRedis();

    expect(mockClients[0].connect).toHaveBeenCalledTimes(1);
    expect(mockClients[1].connect).toHaveBeenCalledTimes(1);
    expect(mockClients[2].connect).toHaveBeenCalledTimes(1);
    expect(mockClients[3].connect).toHaveBeenCalledTimes(1);

    // ensureRedis() (prod branch) returns redisKv only
    expect(out1).toBe(mockClients[3]);

    // Second call: ready=true => no more connect() calls
    mockClients.forEach((c) => c.connect.mockClear());

    const out2 = await ensureRedis();

    expect(mockClients[0].connect).not.toHaveBeenCalled();
    expect(mockClients[1].connect).not.toHaveBeenCalled();
    expect(mockClients[2].connect).not.toHaveBeenCalled();
    expect(mockClients[3].connect).not.toHaveBeenCalled();

    // still returns redisKv
    expect(out2).toBe(mockClients[3]);
  });

  test('rSetJSON() stringifies payload and sets EX when ttlSec provided', async () => {
    const { mod, mockClients } = await loadModuleWithRedisMock({
      redisUrl: 'redis://anything',
    });

    const { rSetJSON } = mod;
    const kv = mockClients[3]; // redisKv mock

    // case: no ttl
    kv.set.mockResolvedValueOnce('OK_NO_TTL');

    const res1 = await rSetJSON('user:1', { name: 'Ada' });
    expect(res1).toBe('OK_NO_TTL');

    expect(kv.set).toHaveBeenCalledWith(
      'user:1',
      JSON.stringify({ name: 'Ada' })
    );

    // case: with ttl
    kv.set.mockResolvedValueOnce('OK_TTL');

    const res2 = await rSetJSON('session:abc', { alive: true }, 120);
    expect(res2).toBe('OK_TTL');

    expect(kv.set).toHaveBeenCalledWith(
      'session:abc',
      JSON.stringify({ alive: true }),
      { EX: 120 }
    );
  });

  test('rGetJSON() returns parsed value or null', async () => {
    const { mod, mockClients } = await loadModuleWithRedisMock({
      redisUrl: 'redis://anything',
    });

    const { rGetJSON } = mod;
    const kv = mockClients[3]; // redisKv mock

    // when value exists
    kv.get.mockResolvedValueOnce(JSON.stringify({ x: 42 }));
    const out1 = await rGetJSON('foo');
    expect(out1).toEqual({ x: 42 });
    expect(kv.get).toHaveBeenCalledWith('foo');

    // when value missing
    kv.get.mockResolvedValueOnce(null);
    const out2 = await rGetJSON('nope');
    expect(out2).toBeNull();
  });
});
