import { jest, describe, test, expect, afterAll } from '@jest/globals';

const ORIGINAL_ENV = { ...process.env };

// If you really need fake timers, keep this.
// Not strictly required for these tests, but harmless.
jest.useFakeTimers();

// ---- Mocks ----
const prismaMock = {
  botEventLog: {
    findMany: jest.fn(),
    update: jest.fn(),
  },
};

const signBodyMock = jest.fn(() => 'signed-body');

// fetch mock on global
const fetchMock = jest.fn();
global.fetch = fetchMock;

// ESM-friendly mocking: unstable_mockModule
jest.unstable_mockModule('../utils/prismaClient.js', () => ({
  __esModule: true,
  default: prismaMock,
}));

jest.unstable_mockModule('../utils/botSign.js', () => ({
  __esModule: true,
  signBody: signBodyMock,
}));

// Helpers to reload module with clean state & env
const reloadWithEnv = async (env = {}) => {
  jest.resetModules();
  prismaMock.botEventLog.findMany.mockReset();
  prismaMock.botEventLog.update.mockReset();
  fetchMock.mockReset();
  signBodyMock.mockClear();

  process.env = { ...ORIGINAL_ENV, ...env };

  // Import after mocks are registered
  const { startBotDispatcher } = await import('../botDispatcher.js');
  return { startBotDispatcher };
};

// Handy builders
const makeEvent = (overrides = {}) => ({
  id: 1,
  type: 'message.created',
  installId: 999,
  attempts: 0,
  payload: { hello: 'world' },
  nextAttemptAt: null,
  install: {
    bot: { url: 'https://bot.example.com/hook', secret: 'sekret' },
    chatRoom: { id: 123 },
  },
  createdAt: new Date(Date.now() - 1000),
  status: 'pending',
  ...overrides,
});

describe('startBotDispatcher', () => {
  afterAll(() => {
    process.env = ORIGINAL_ENV;
  });

  test('returns {stop} only and does not setInterval when disabled', async () => {
    const setIntervalSpy = jest.spyOn(global, 'setInterval');
    const { startBotDispatcher } = await reloadWithEnv({
      BOT_WEBHOOKS_ENABLED: 'false',
    });

    const ret = startBotDispatcher({}); // io is unused in current logic
    expect(ret).toHaveProperty('stop');
    expect(ret).not.toHaveProperty('tick');
    expect(setIntervalSpy).toHaveBeenCalledTimes(0);

    // stop() should be a no-op
    expect(() => ret.stop()).not.toThrow();

    setIntervalSpy.mockRestore();
  });

  test('successful delivery marks event as delivered', async () => {
    const NOW = 1_700_000_000_000;
    const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(NOW);

    const { startBotDispatcher } = await reloadWithEnv({
      BOT_WEBHOOKS_ENABLED: 'true',
      BOT_MAX_RETRIES: '5',
    });

    prismaMock.botEventLog.findMany.mockResolvedValue([
      makeEvent({ id: 10, attempts: 0 }),
    ]);

    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => 'ok',
    });

    const { tick } = startBotDispatcher({});
    await tick();

    // Fetched pending batch
    expect(prismaMock.botEventLog.findMany).toHaveBeenCalledWith({
      where: {
        status: 'pending',
        OR: [
          { nextAttemptAt: null },
          { nextAttemptAt: { lte: expect.any(Date) } },
        ],
      },
      orderBy: { createdAt: 'asc' },
      take: 20,
      include: {
        install: { include: { bot: true, chatRoom: { select: { id: true } } } },
      },
    });

    // Correct POST
    expect(fetchMock).toHaveBeenCalledWith(
      'https://bot.example.com/hook',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'Content-Type': 'application/json',
          'X-Chatforia-Event': 'message.created',
          'X-Chatforia-Install': '999',
          'X-Chatforia-Timestamp': String(NOW),
          'X-Chatforia-Signature': 'signed-body',
        }),
        body: JSON.stringify({ hello: 'world' }),
      }),
    );

    // Marked delivered
    expect(prismaMock.botEventLog.update).toHaveBeenCalledWith({
      where: { id: 10 },
      data: { status: 'delivered', lastError: null },
    });

    nowSpy.mockRestore();
  });

  test('failure schedules retry with backoff and increments attempts', async () => {
    // backoff attempt 0 -> 5000ms
    const NOW = 1_800_000_000_000;
    const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(NOW);

    const { startBotDispatcher } = await reloadWithEnv({
      BOT_WEBHOOKS_ENABLED: 'true',
      BOT_MAX_RETRIES: '3',
    });

    prismaMock.botEventLog.findMany.mockResolvedValue([
      makeEvent({ id: 22, attempts: 0 }),
    ]);

    fetchMock.mockResolvedValue({
      ok: false,
      status: 503,
      text: async () => 'upstream down',
    });

    const { tick } = startBotDispatcher({});
    await tick();

    // Should set attempts=1, nextAttemptAt = NOW + 5000, status 'pending'
    const updateArgs = prismaMock.botEventLog.update.mock.calls[0][0];
    expect(updateArgs.where).toEqual({ id: 22 });
    expect(updateArgs.data.attempts).toBe(1);
    expect(+updateArgs.data.nextAttemptAt - NOW).toBe(5000);
    expect(updateArgs.data.status).toBe('pending');
    expect(updateArgs.data.lastError).toMatch(/^http_503:/);

    nowSpy.mockRestore();
  });

  test('failure at final retry marks failed and clears nextAttemptAt', async () => {
    // MAX_RETRIES=3; attempts=2 → next becomes 3 => failed
    const NOW = 1_900_000_000_000;
    const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(NOW);

    const { startBotDispatcher } = await reloadWithEnv({
      BOT_WEBHOOKS_ENABLED: 'true',
      BOT_MAX_RETRIES: '3',
    });

    prismaMock.botEventLog.findMany.mockResolvedValue([
      makeEvent({ id: 33, attempts: 2 }),
    ]);

    fetchMock.mockResolvedValue({
      ok: false,
      status: 500,
      text: async () => 'boom',
    });

    const { tick } = startBotDispatcher({});
    await tick();

    const updateArgs = prismaMock.botEventLog.update.mock.calls[0][0];
    expect(updateArgs.where).toEqual({ id: 33 });
    expect(updateArgs.data.attempts).toBe(3);
    expect(updateArgs.data.nextAttemptAt).toBeNull();
    expect(updateArgs.data.status).toBe('failed');
    expect(updateArgs.data.lastError).toMatch(/^http_500:/);

    nowSpy.mockRestore();
  });

  test('invalid config or retries exhausted immediately → failed (no fetch)', async () => {
    const { startBotDispatcher } = await reloadWithEnv({
      BOT_WEBHOOKS_ENABLED: 'true',
      BOT_MAX_RETRIES: '5',
    });

    prismaMock.botEventLog.findMany
      .mockResolvedValueOnce([
        // Missing URL
        makeEvent({ id: 44, install: { bot: { url: '', secret: 's' } } }),
      ])
      .mockResolvedValueOnce([
        // Missing secret
        makeEvent({
          id: 45,
          install: { bot: { url: 'https://ok', secret: '' } },
        }),
      ])
      .mockResolvedValueOnce([
        // Already at or above max attempts
        makeEvent({ id: 46, attempts: 5 }),
      ]);

    const { tick } = startBotDispatcher({});

    // Case 1: missing URL
    await tick();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(prismaMock.botEventLog.update).toHaveBeenCalledWith({
      where: { id: 44 },
      data: {
        status: 'failed',
        lastError: 'invalid_config_or_retries_exhausted',
      },
    });

    prismaMock.botEventLog.update.mockClear();

    // Case 2: missing secret
    await tick();
    expect(prismaMock.botEventLog.update).toHaveBeenCalledWith({
      where: { id: 45 },
      data: {
        status: 'failed',
        lastError: 'invalid_config_or_retries_exhausted',
      },
    });

    prismaMock.botEventLog.update.mockClear();

    // Case 3: attempts >= MAX_RETRIES
    await tick();
    expect(prismaMock.botEventLog.update).toHaveBeenCalledWith({
      where: { id: 46 },
      data: {
        status: 'failed',
        lastError: 'invalid_config_or_retries_exhausted',
      },
    });
  });

  test('concurrency guard prevents overlapping runs', async () => {
    const { startBotDispatcher } = await reloadWithEnv({
      BOT_WEBHOOKS_ENABLED: 'true',
    });

    // Make findMany resolve after a little delay to simulate long run
    let resolveFindMany;
    const findManyPromise = new Promise((r) => (resolveFindMany = r));
    prismaMock.botEventLog.findMany.mockReturnValue(findManyPromise);

    const { tick } = startBotDispatcher({});

    // Kick off the first tick (running=true)
    const t1 = tick();

    // Immediately call a second tick; should return quickly without another findMany
    const t2 = tick();

    // Finish the first findMany
    resolveFindMany([]);
    await Promise.all([t1, t2]);

    expect(prismaMock.botEventLog.findMany).toHaveBeenCalledTimes(1);
  });
});
