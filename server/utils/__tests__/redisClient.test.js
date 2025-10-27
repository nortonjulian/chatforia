import { jest } from '@jest/globals';

const ORIGINAL_ENV = { ...process.env };

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  jest.resetModules();
  jest.restoreAllMocks();
});

async function loadModuleWithRedisMock({ redisUrl } = {}) {
  jest.resetModules();

  if (redisUrl !== undefined) {
    process.env.REDIS_URL = redisUrl;
  } else {
    delete process.env.REDIS_URL;
  }

  // We'll create mock client objects for each call to createClient.
  // redisClient.js calls createClient 4 times back-to-back, so we'll hand out
  // 4 distinct fake clients in order: pub, sub, redis, redisKv.

  const clientFactoryCalls = [];
  const mockClients = [];

  function makeClient(label) {
    const handlers = {};
    return {
      label,
      connect: jest.fn(async () => {
        // pretend it connected
      }),
      on: jest.fn((event, cb) => {
        handlers[event] = cb;
        return undefined;
      }),
      set: jest.fn(async () => 'OK'),
      get: jest.fn(async () => null),
      _handlers: handlers,
    };
  }

  // We'll enqueue 4 clients. The module will grab them in order.
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

  jest.unstable_mockModule('redis', () => ({
    createClient: createClientMock,
  }));

  const mod = await import('../../utils/redisClient.js');

  return {
    mod,
    mockClients,
    createClientMock,
    clientFactoryCalls,
  };
}

describe('redisClient.js', () => {
  test('creates four Redis clients with the correct URL and attaches error handlers', async () => {
    const { mockClients, createClientMock, clientFactoryCalls, mod } =
      await loadModuleWithRedisMock({
        redisUrl: 'redis://example:9999',
      });

    // We should have created 4 clients
    expect(createClientMock).toHaveBeenCalledTimes(4);

    // Each call should have included the URL we passed
    expect(clientFactoryCalls).toEqual([
      { url: 'redis://example:9999' },
      { url: 'redis://example:9999' },
      { url: 'redis://example:9999' },
      { url: 'redis://example:9999' },
    ]);

    // The module exports these four
    expect(mod.redisPub).toBe(mockClients[0]);
    expect(mod.redisSub).toBe(mockClients[1]);
    expect(mod.redis).toBe(mockClients[2]);
    expect(mod.redisKv).toBe(mockClients[3]);

    // It also attaches .on('error', handler) to each of them during import
    for (const c of mockClients) {
      expect(c.on).toHaveBeenCalledWith(
        'error',
        expect.any(Function)
      );

      // Let's sanity check that the handler logs to console.error.
      const consoleSpy = jest
        .spyOn(console, 'error')
        .mockImplementation(() => {});
      const handler = c._handlers['error'];
      handler && handler(new Error('boom'));
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringMatching(/^Redis client \d+ error:/),
        expect.any(Error)
      );
      consoleSpy.mockRestore();
    }
  });

  test('ensureRedis() connects all clients once, caches readiness, and returns them', async () => {
    const { mod, mockClients } = await loadModuleWithRedisMock({
      redisUrl: 'redis://localtest:6379',
    });

    const { ensureRedis } = mod;

    // First call: should call connect() on all four
    const out1 = await ensureRedis();

    expect(mockClients[0].connect).toHaveBeenCalledTimes(1);
    expect(mockClients[1].connect).toHaveBeenCalledTimes(1);
    expect(mockClients[2].connect).toHaveBeenCalledTimes(1);
    expect(mockClients[3].connect).toHaveBeenCalledTimes(1);

    // It should resolve with the same four clients
    expect(out1.redisPub).toBe(mockClients[0]);
    expect(out1.redisSub).toBe(mockClients[1]);
    expect(out1.redis).toBe(mockClients[2]);
    expect(out1.redisKv).toBe(mockClients[3]);

    // Second call: should NOT connect again (ready flag should short-circuit)
    mockClients.forEach((c) => c.connect.mockClear());

    const out2 = await ensureRedis();

    expect(mockClients[0].connect).not.toHaveBeenCalled();
    expect(mockClients[1].connect).not.toHaveBeenCalled();
    expect(mockClients[2].connect).not.toHaveBeenCalled();
    expect(mockClients[3].connect).not.toHaveBeenCalled();

    // Still returns same objects
    expect(out2.redisPub).toBe(mockClients[0]);
    expect(out2.redisSub).toBe(mockClients[1]);
    expect(out2.redis).toBe(mockClients[2]);
    expect(out2.redisKv).toBe(mockClients[3]);
  });

  test('rSetJSON() stringifies payload and sets EX when ttlSec provided', async () => {
    const { mod, mockClients } = await loadModuleWithRedisMock({
      redisUrl: 'redis://anything',
    });

    const { rSetJSON } = mod;
    const kv = mockClients[3]; // redisKv

    kv.set.mockResolvedValueOnce('OK_NO_TTL');

    const res1 = await rSetJSON('user:1', { name: 'Ada' });
    expect(res1).toBe('OK_NO_TTL');

    expect(kv.set).toHaveBeenCalledWith(
      'user:1',
      JSON.stringify({ name: 'Ada' })
    );

    // with ttl
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
    const kv = mockClients[3];

    // case: key set
    kv.get.mockResolvedValueOnce(JSON.stringify({ x: 42 }));
    const out1 = await rGetJSON('foo');
    expect(out1).toEqual({ x: 42 });
    expect(kv.get).toHaveBeenCalledWith('foo');

    // case: key missing
    kv.get.mockResolvedValueOnce(null);
    const out2 = await rGetJSON('nope');
    expect(out2).toBeNull();
  });
});
