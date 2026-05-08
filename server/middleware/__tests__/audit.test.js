import { jest } from '@jest/globals';
import { EventEmitter } from 'events';

// ---- Mocks ----

const pinoChild = {
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  child: jest.fn(() => pinoChild),
};

jest.mock('pino', () => ({
  __esModule: true,
  default: () => pinoChild,
}));

jest.mock('@sentry/node', () => ({
  __esModule: true,
  default: {},
  init: jest.fn(),
  captureException: jest.fn(),
  setTag: jest.fn(),
  setContext: jest.fn(),
  setUser: jest.fn(),
}));

const promCounters = [];
const promHistograms = [];

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
  Registry,
  collectDefaultMetrics,
}));

jest.mock('crypto', () => ({
  randomUUID: jest.fn(() => 'uuid-123'),
}));

beforeEach(() => {
  promCounters.length = 0;
  promHistograms.length = 0;

  pinoChild.info.mockClear();
  pinoChild.warn.mockClear();
  pinoChild.error.mockClear();
  pinoChild.child.mockClear();
});

const loadModule = async () => {
  delete process.env.SENTRY_DSN;
  const mod = await import('../audit.js');
  return { mod };
};

const makeReqResNext = (overrides = {}) => {
  const req = Object.assign(
    {
      method: 'POST',
      headers: {},
      route: { path: '/messages/:id' },
      baseUrl: '',
      path: '/messages/123',
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
    setHeader(k, v) {
      this.headers[k.toLowerCase()] = v;
    },
    getHeader(k) {
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

const tick = () => Promise.resolve();

describe('audit middleware suite', () => {
  test('audit(): writes audit log metadata and increments metric (actor present)', async () => {
    const { mod } = await loadModule();

    const redactor = () => ({
      password: 'secret',
      token: 'abc',
    });

    const { req, res, next } = makeReqResNext();

    const mw = mod.audit('MESSAGE_SEND', {
      redactor,
    });

    mw(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);

    res.emit('finish');
    await tick();

    const auditInc = promCounters.find(
      ({ cfg, labels }) =>
        cfg?.name === 'audit_logs_total' &&
        labels?.action === 'MESSAGE_SEND' &&
        labels?.status === '200'
    );

    expect(auditInc).toBeDefined();
  });

  test('audit(): no-op when req.user.id is missing', async () => {
    const { mod } = await loadModule();

    const { req, res, next } = makeReqResNext({
      req: { user: undefined },
    });

    const mw = mod.audit('LOGIN', {});
    mw(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);

    res.emit('finish');
    await tick();

    const auditIncs = promCounters.filter(
      ({ cfg }) => cfg?.name === 'audit_logs_total'
    );

    expect(auditIncs.length).toBe(0);
  });

  test('audit(): continues if redactor throws and still increments metric', async () => {
    const { mod } = await loadModule();

    const badRedactor = () => {
      throw new Error('boom');
    };

    const { req, res, next } = makeReqResNext();

    const mw = mod.audit('UPDATE_PROFILE', {
      redactor: badRedactor,
    });

    mw(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);

    res.emit('finish');
    await tick();

    const auditInc = promCounters.find(
      ({ cfg, labels }) =>
        cfg?.name === 'audit_logs_total' &&
        labels?.action === 'UPDATE_PROFILE' &&
        labels?.status === '200'
    );

    expect(auditInc).toBeDefined();
    expect(pinoChild.warn).toHaveBeenCalled();
  });

  test('metricsEndpoint(): returns metrics', async () => {
    const { mod } = await loadModule();

    const { req, res } = makeReqResNext();

    await mod.metricsEndpoint(req, res);

    expect(res.getHeader('content-type')).toBe(
      mod.metricsRegistry.contentType
    );

    expect(res.end).toHaveBeenCalledWith(expect.any(String));
  });

  test('metricsEndpoint(): handles error path', async () => {
    const { mod } = await loadModule();

    mod.metricsRegistry.metrics = () => {
      throw new Error('fail');
    };

    const { req, res } = makeReqResNext();

    await mod.metricsEndpoint(req, res);

    expect(res.statusCode).toBe(500);
    expect(res.end).toHaveBeenCalledWith('metrics error');
    expect(pinoChild.error).toHaveBeenCalled();
  });

  test('requestId(): keeps existing req.id otherwise generates', async () => {
    const { mod } = await loadModule();

    {
      const { req, res, next } = makeReqResNext({
        req: { id: 'incoming-id' },
      });

      mod.requestId(req, res, next);

      expect(req.id).toBe('incoming-id');
      expect(next).toHaveBeenCalledTimes(1);
    }

    {
      const { req, res, next } = makeReqResNext({
        req: { id: undefined },
      });

      mod.requestId(req, res, next);

      expect(req.id).toBe('uuid-123');
      expect(next).toHaveBeenCalledTimes(1);
    }
  });
});