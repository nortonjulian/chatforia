import { jest } from '@jest/globals';
import { EventEmitter } from 'events';

// ---- Mocks ----

// A single logger object that pino() will return
const pinoChild = {
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  child: jest.fn(() => pinoChild),
};

// pino mock: default export is a function returning our logger
jest.mock('pino', () => ({
  __esModule: true,
  default: () => pinoChild,
}));

jest.mock('@sentry/node', () => ({
  __esModule: true,
  default: {},
  Handlers: {
    requestHandler: () => (req, res, next) => next(),
    errorHandler: () => (err, req, res, next) => next(err),
  },
  init: jest.fn(),
  captureException: jest.fn(),
}));

// Lightweight prom-client stub that records calls
const promCounters = [];
const promHistograms = [];
const promGauges = [];

class Counter {
  constructor(cfg) {
    this.cfg = cfg;
    this.inc = jest.fn((labels, value) =>
      promCounters.push({ cfg, labels, value })
    );
  }
}
class Histogram {
  constructor(cfg) {
    this.cfg = cfg;
    this.observe = jest.fn((labels, value) =>
      promHistograms.push({ cfg, labels, value })
    );
  }
}
class Gauge {
  constructor(cfg) {
    this.cfg = cfg;
    this.set = jest.fn((value) => promGauges.push({ cfg, value }));
  }
}
class Registry {
  constructor() {
    this.contentType = 'text/plain; version=0.0.4';
    this._metrics = 'mock_metrics';
  }
  metrics() {
    return this._metrics;
  }
}

const collectDefaultMetrics = jest.fn();

jest.mock('prom-client', () => ({
  __esModule: true,
  Counter,
  Histogram,
  Gauge,
  Registry,
  collectDefaultMetrics,
}));

// Stable UUID for tests (used by requestId())
jest.mock('crypto', () => ({
  randomUUID: jest.fn(() => 'uuid-123'),
}));

// Reset metric logs between tests
beforeEach(() => {
  promCounters.length = 0;
  promHistograms.length = 0;
  promGauges.length = 0;

  // also reset logger calls
  pinoChild.info.mockClear();
  pinoChild.warn.mockClear();
  pinoChild.error.mockClear();
  pinoChild.child.mockClear();
});

// Helper to (re)load module under test
const loadModule = async () => {
  // Ensure Sentry stays disabled in tests unless explicitly set
  delete process.env.SENTRY_DSN;

  // No resetModules here, so mocks (like crypto) stay in effect
  const mod = await import('../audit.js');
  return { mod };
};

// Minimal req/res for middleware testing
const makeReqResNext = (overrides = {}) => {
  const req = Object.assign(
    {
      method: 'POST',
      headers: {},
      get: function (key) {
        const v = this.headers[key.toLowerCase()];
        return v || undefined;
      },
      route: { path: '/messages/:id' },
      baseUrl: '',
      originalUrl: '/messages/123',
      socket: { remoteAddress: '10.0.0.1' },
      ip: '127.0.0.1',
      user: { id: 'user-1' },
      id: 'req-1',
    },
    overrides.req || {}
  );

  const emitter = new EventEmitter();
  const res = Object.assign(emitter, {
    statusCode: 200,
    headers: {},
    setHeader: function (k, v) {
      this.headers[k.toLowerCase()] = v;
    },
    getHeader: function (k) {
      return this.headers[k.toLowerCase()];
    },
    end: jest.fn(),
    send: jest.fn(),
    on: emitter.on.bind(emitter),
    removeListener: emitter.removeListener.bind(emitter),
  });

  const next = jest.fn();
  return { req, res, next };
};

// Allow awaiting microtasks flush (no fake timers needed)
const tick = () => Promise.resolve();

describe('audit middleware suite', () => {
  test('audit(): writes audit log metadata and increments metric (actor present)', async () => {
    const { mod } = await loadModule();

    const redactor = () => ({
      password: 'secret',
      token: 'abc',
      nested: { access_token: 'xyz', keep: 'safe' },
      arr: [{ api_key: 'k' }, 1, true, 'str'],
    });

    const { req, res, next } = makeReqResNext({
      req: {
        headers: {
          'x-forwarded-for': '1.2.3.4, 9.9.9.9',
          'user-agent': 'UA',
        },
      },
    });

    const mw = mod.audit('MESSAGE_SEND', {
      resource: 'message',
      resourceId: 123,
      redactor,
    });

    mw(req, res, next);

    // simulate response finished
    res.emit('finish');
    await tick();

    // We can't see DB writes here, but the audit counter should have incremented
    const auditInc = promCounters.find(
      ({ cfg, labels }) =>
        cfg?.name === 'audit_logs_total' &&
        labels?.action === 'MESSAGE_SEND' &&
        labels?.status === '200'
    );
    expect(auditInc).toBeDefined();
  });

  test('audit(): no-op (no metric) when req.user.id is missing', async () => {
    const { mod } = await loadModule();

    const { req, res, next } = makeReqResNext({
      req: { user: undefined },
    });

    const mw = mod.audit('LOGIN', {});
    mw(req, res, next);

    res.emit('finish');
    await tick();

    // No audit_logs_total increments when there is no actorId
    const auditIncs = promCounters.filter(
      ({ cfg }) => cfg?.name === 'audit_logs_total'
    );
    expect(auditIncs.length).toBe(0);
  });

  test('audit(): continues if redactor throws (still increments metric)', async () => {
    const { mod } = await loadModule();

    const badRedactor = () => {
      throw new Error('boom');
    };

    const { req, res, next } = makeReqResNext();
    const mw = mod.audit('UPDATE_PROFILE', { redactor: badRedactor });

    mw(req, res, next);
    res.emit('finish');
    await tick();

    // Should still record an audit metric for UPDATE_PROFILE
    const auditInc = promCounters.find(
      ({ cfg, labels }) =>
        cfg?.name === 'audit_logs_total' &&
        labels?.action === 'UPDATE_PROFILE' &&
        labels?.status === '200'
    );
    expect(auditInc).toBeDefined();

    // And it should have logged a warning (through logger.warn)
    expect(pinoChild.warn).toHaveBeenCalled();
  });

  test('metricsEndpoint(): returns metrics', async () => {
    const { mod } = await loadModule();

    const { req, res } = makeReqResNext();
    await mod.metricsEndpoint(req, res);

    expect(
      res.getHeader('content-type') || res.headers['content-type']
    ).toBe(mod.metricsRegistry.contentType);
    expect(res.end).toHaveBeenCalledWith(expect.any(String));
  });

  test('metricsEndpoint(): handles error path', async () => {
    const { mod } = await loadModule();

    // Force registry.metrics() to throw
    mod.metricsRegistry.metrics = () => {
      throw new Error('fail');
    };

    const { req, res } = makeReqResNext();
    // add status for send path
    res.status = (code) => {
      res.statusCode = code;
      return res;
    };

    await mod.metricsEndpoint(req, res);

    expect(res.statusCode).toBe(500);
    expect(res.send).toHaveBeenCalledWith('metrics error');
    expect(pinoChild.error).toHaveBeenCalled();
  });

  test('requestId(): uses header if present, otherwise generates', async () => {
    const { mod } = await loadModule();

    // Case 1: existing header
    {
      const { req, res, next } = makeReqResNext({
        req: { headers: { 'x-request-id': 'incoming-id' } },
      });
      const mw = mod.requestId();
      mw(req, res, next);

      expect(req.id).toBe('incoming-id');
      expect(
        res.getHeader('x-request-id') || res.headers['x-request-id']
      ).toBe('incoming-id');
      expect(next).toHaveBeenCalled();
    }

    // Case 2: generate
    {
      const { req, res, next } = makeReqResNext();
      const mw = mod.requestId();
      mw(req, res, next);

      expect(req.id).toBe('uuid-123'); // from crypto mock
      expect(
        res.getHeader('x-request-id') || res.headers['x-request-id']
      ).toBe('uuid-123');
      expect(next).toHaveBeenCalled();
    }
  });

  test('requestLogger(): logs and records metrics on finish', async () => {
    const { mod } = await loadModule();

    const { req, res, next } = makeReqResNext({
      req: {
        method: 'GET',
        originalUrl:
          '/rooms/550e8400-e29b-41d4-a716-446655440000/messages/42',
      },
    });

    const mw = mod.requestLogger();
    mw(req, res, next);

    // Simulate a 201 response finishing
    res.statusCode = 201;
    res.emit('finish');

    // Ensure logger child was attached
    expect(req.log).toBeDefined();

    // Our mocked logger records calls:
    expect(pinoChild.child).toHaveBeenCalled();
    expect(pinoChild.info).toHaveBeenCalledWith(
      expect.objectContaining({ ip: expect.any(String) }),
      'HTTP request start'
    );
    expect(pinoChild.info).toHaveBeenCalledWith(
      expect.objectContaining({ status: 201, durationMs: expect.any(Number) }),
      'HTTP request end'
    );
  });
});
