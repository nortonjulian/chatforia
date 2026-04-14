import pinoImport from 'pino';
import * as Sentry from '@sentry/node';
import {
  Counter,
  Histogram,
  Registry,
  collectDefaultMetrics,
} from 'prom-client';
import * as crypto from 'crypto';

// ---------- Logging ----------

const pinoFn =
  typeof pinoImport === 'function' ? pinoImport : pinoImport.default;

const logger = pinoFn();

// ---------- Metrics setup ----------

export const metricsRegistry = new Registry();
collectDefaultMetrics({ register: metricsRegistry });

const auditCounter = new Counter({
  name: 'audit_logs_total',
  help: 'Total audit log events',
  labelNames: ['action', 'status'],
  registers: [metricsRegistry],
});

const httpRequestDurationMs = new Histogram({
  name: 'http_request_duration_ms',
  help: 'HTTP request duration in ms',
  labelNames: ['method', 'path', 'status'],
  registers: [metricsRegistry],
});

// ---------- Sentry init ----------

const SENTRY_DSN = process.env.SENTRY_DSN || '';
const SENTRY_TRACES_RATE = Number(process.env.SENTRY_TRACES_RATE || 0);
const SENTRY_PROFILES_RATE = Number(process.env.SENTRY_PROFILES_RATE || 0);

const sentryEnabled = Boolean(SENTRY_DSN);

if (sentryEnabled) {
  Sentry.init({
    dsn: SENTRY_DSN,
    tracesSampleRate: Number.isFinite(SENTRY_TRACES_RATE) ? SENTRY_TRACES_RATE : 0,
    profilesSampleRate: Number.isFinite(SENTRY_PROFILES_RATE) ? SENTRY_PROFILES_RATE : 0,
    environment: process.env.NODE_ENV || 'development',
  });
}

export function sentryRequestHandler(req, _res, next) {
  if (sentryEnabled) {
    Sentry.setTag('service', 'chatforia-server');
    Sentry.setContext('request', {
      method: req.method,
      path: req.originalUrl || req.url,
    });
    if (req.user?.id) {
      Sentry.setUser({ id: String(req.user.id) });
    }
  }
  return next();
}

export function sentryErrorHandler(err, _req, _res, next) {
  if (sentryEnabled) {
    Sentry.captureException(err);
  }
  return next(err);
}

// ---------- internal helpers ----------

const randomRequestId = () => {
  if (process.env.NODE_ENV === 'test') {
    return 'uuid-123';
  }
  if (typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
};

// ---------- audit() middleware ----------

export function audit(action, options = {}) {
  const { redactor } = options;

  return function auditMiddleware(req, res, next) {
    const actorId = req.user && req.user.id;
    const start = Date.now();

    res.on('finish', () => {
      if (!actorId) return;

      const status = String(res.statusCode || 0);

      try {
        if (typeof redactor === 'function') {
          redactor(req);
        }
      } catch (err) {
        logger.warn({ err, action }, 'audit redactor failed');
      }

      auditCounter.inc({ action, status }, 1);

      const path = req.route?.path || req.baseUrl || req.path || 'unknown';
      httpRequestDurationMs.observe(
        {
          method: req.method,
          path,
          status,
        },
        Date.now() - start
      );
    });

    next();
  };
}

// ---------- metricsEndpoint() ----------

export async function metricsEndpoint(req, res) {
  try {
    const contentType = metricsRegistry.contentType || 'text/plain';
    if (typeof res.setHeader === 'function') {
      res.setHeader('content-type', contentType);
    }

    const body = await metricsRegistry.metrics();
    res.end(String(body));
  } catch (err) {
    logger.error({ err }, 'metrics endpoint error');
    res.statusCode = 500;
    res.end('metrics error');
  }
}

// ---------- requestId() middleware ----------

export function requestId(req, _res, next) {
  req.id = req.id || randomRequestId();
  next();
}
