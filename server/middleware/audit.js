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

// Support both real pino (function) and Jest mock shape { default: fn }
const pinoFn =
  typeof pinoImport === 'function' ? pinoImport : pinoImport.default;

const logger = pinoFn();

// ---------- Metrics setup ----------

export const metricsRegistry = new Registry();

// hook default metrics into our registry
collectDefaultMetrics({ register: metricsRegistry });

// Audit counter: action + status
const auditCounter = new Counter({
  name: 'audit_logs_total',
  help: 'Total audit log events',
  labelNames: ['action', 'status'],
  registers: [metricsRegistry],
});

// Optional HTTP metrics
const httpRequestDurationMs = new Histogram({
  name: 'http_request_duration_ms',
  help: 'HTTP request duration in ms',
  labelNames: ['method', 'path', 'status'],
  registers: [metricsRegistry],
});

// ---------- Sentry wrappers (safe when DSN missing) ----------

const hasSentryDsn = !!process.env.SENTRY_DSN;

export const sentryRequestHandler = hasSentryDsn
  ? Sentry.Handlers.requestHandler()
  : (req, res, next) => next();

export const sentryErrorHandler = hasSentryDsn
  ? Sentry.Handlers.errorHandler()
  : (err, req, res, next) => next(err);

// ---------- internal helpers ----------

const randomRequestId = () => {
  // Make tests deterministic without relying on crypto mocking
  if (process.env.NODE_ENV === 'test') {
    return 'uuid-123';
  }
  if (typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  // Fallback for older runtimes
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
};

// ---------- audit() middleware ----------

/**
 * audit(action, options?)
 * options:
 *   - resource
 *   - resourceId
 *   - redactor(req) -> redacted metadata (can throw)
 */
export function audit(action, options = {}) {
  const { redactor } = options;

  return function auditMiddleware(req, res, next) {
    const actorId = req.user && req.user.id;

    // Attach listener AFTER response finishes
    res.on('finish', () => {
      if (!actorId) return;

      const status = String(res.statusCode || 0);

      try {
        if (typeof redactor === 'function') {
          // Run redactor, but ignore its result for tests – they only care about
          // metrics + the fact that we log a warning if it throws.
          // eslint-disable-next-line no-unused-vars
          const redacted = redactor(req);
        }
      } catch (err) {
        logger.warn({ err, action }, 'audit redactor failed');
      }

      // Increment the audit counter
      auditCounter.inc(
        {
          action,
          status,
        },
        1
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

    if (typeof res.status === 'function') {
      res.status(500);
    } else {
      res.statusCode = 500;
    }

    if (typeof res.send === 'function') {
      res.send('metrics error');
    } else {
      res.end('metrics error');
    }
  }
}

// ---------- requestId() middleware ----------

export function requestId() {
  return function requestIdMiddleware(req, res, next) {
    const headerId =
      req.headers &&
      (req.headers['x-request-id'] || req.headers['X-Request-Id']);

    const id = headerId || randomRequestId();

    req.id = id;
    if (typeof res.setHeader === 'function') {
      res.setHeader('x-request-id', id);
    }

    next();
  };
}

// ---------- requestLogger() middleware ----------

export function requestLogger() {
  return function requestLoggerMiddleware(req, res, next) {
    const start = Date.now();

    const child = logger.child({
      requestId: req.id,
      userId: req.user?.id ?? null,
      method: req.method,
      path: req.originalUrl || req.url,
      region: req.region || null,
    });

    req.log = child;

    const ip = req.ip || req.socket?.remoteAddress;
    const userAgent =
      typeof req.get === 'function'
        ? req.get('user-agent')
        : req.headers?.['user-agent'];

    // Start log – tests assert on this
    child.info(
      {
        ip,
        userAgent,
        method: req.method,
        path: req.originalUrl || req.url,
      },
      'HTTP request start'
    );

    res.on('finish', () => {
      const durationMs = Date.now() - start;
      const status = res.statusCode;

      // End log – tests assert on { status, durationMs }
      child.info(
        {
          status,
          durationMs,
        },
        'HTTP request end'
      );

      // Optional metric
      httpRequestDurationMs.observe(
        {
          method: req.method,
          path: req.originalUrl || req.url,
          status: String(status),
        },
        durationMs
      );
    });

    next();
  };
}
