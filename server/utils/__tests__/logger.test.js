import { jest } from '@jest/globals';

const ORIGINAL_ENV = { ...process.env };

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  jest.resetModules();
  jest.restoreAllMocks();
});

async function loadLoggerWithEnv({
  nodeEnv,
  logLevel,
} = {}) {
  jest.resetModules();

  if (nodeEnv !== undefined) {
    process.env.NODE_ENV = nodeEnv;
  } else {
    delete process.env.NODE_ENV;
  }

  if (logLevel !== undefined) {
    process.env.LOG_LEVEL = logLevel;
  } else {
    delete process.env.LOG_LEVEL;
  }

  // We'll capture what `pino()` was called with, and return a fake logger object.
  const pinoCallArgs = [];
  const fakeLogger = { info: jest.fn(), error: jest.fn(), child: jest.fn() };
  const pinoMock = jest.fn((opts) => {
    pinoCallArgs.push(opts);
    return fakeLogger;
  });

  jest.unstable_mockModule('pino', () => ({
    default: pinoMock,
  }));

  const mod = await import('../../utils/logger.js');

  return {
    mod,
    fakeLogger,
    pinoMock,
    pinoCallArgs,
  };
}

describe('logger.js', () => {
  test('in non-production env, uses pretty transport and default level "info"', async () => {
    const { mod, pinoCallArgs } = await loadLoggerWithEnv({
      nodeEnv: 'development', // anything !== 'production'
      // LOG_LEVEL unset -> default "info"
    });

    // module default export should be whatever pino() returned
    expect(mod.default).toBeDefined();

    // pino should have been called exactly once
    expect(pinoCallArgs).toHaveLength(1);
    const opts = pinoCallArgs[0];

    // level falls back to "info"
    expect(opts.level).toBe('info');

    // redact config should exactly match what we expect to protect secrets
    expect(opts.redact).toEqual({
      paths: [
        'req.headers.authorization',
        'req.headers.cookie',
        'res.headers["set-cookie"]',
        'password',
      ],
      censor: '[REDACTED]',
    });

    // base metadata
    expect(opts.base).toEqual({
      service: 'chatforia-server',
      env: 'development',
    });

    // non-production => pretty transport
    expect(opts.transport).toEqual({
      target: 'pino-pretty',
      options: {
        colorize: true,
        singleLine: true,
      },
    });
  });

  test('in production env, omits transport, uses LOG_LEVEL override, and sets base.env correctly', async () => {
    const { pinoCallArgs } = await loadLoggerWithEnv({
      nodeEnv: 'production',
      logLevel: 'debug',
    });

    expect(pinoCallArgs).toHaveLength(1);
    const opts = pinoCallArgs[0];

    // level should reflect LOG_LEVEL
    expect(opts.level).toBe('debug');

    // base.env should be "production"
    expect(opts.base).toEqual({
      service: 'chatforia-server',
      env: 'production',
    });

    // production => no transport pretty-printing
    expect(opts.transport).toBeUndefined();

    // redact should still be correct (don’t leak secrets in prod)
    expect(opts.redact).toEqual({
      paths: [
        'req.headers.authorization',
        'req.headers.cookie',
        'res.headers["set-cookie"]',
        'password',
      ],
      censor: '[REDACTED]',
    });
  });
});
