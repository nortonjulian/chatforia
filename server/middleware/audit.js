import pino from 'pino';
import * as Sentry from '@sentry/node';
import * as promClient from 'prom-client';
import { randomUUID } from 'crypto';

/**
 * -----------------------------------------------------------------------------
 * Observability middleware & utilities
 * - Structured logging (pino) with request-id correlation
 * - Audit log writer with sensitive field redaction
 * - Prometheus metrics (default + HTTP + domain counters/gauges)
 * - Optional Sentry initialization and handlers (SAFE / NO-OP when disabled)
 * -----------------------------------------------------------------------------
 */

/* ========================= Logger (pino) ========================= */
export const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  base: {
    service: 'chatforia-api',
    env: process.env.NODE_ENV || 'development',
  },
});

/* ========================= Sentry (optional, SAFE) ========================= */
const rawDsn = (process.env.SENTRY_DSN || '').trim();

// treat DSN as “present” only if it looks non-placeholder
const SENTRY_ENABLED = !!rawDsn && !/^<.*>$/.test(rawDsn);

let _sentryInitialized = false;
if (SENTRY_ENABLED) {
  try {
    const tracesRate =
      process.env.SENTRY_TRACES_SAMPLE_RATE ??
      process.env.SENTRY_TRACES_RATE ??
      '0.1';
    const profilesRate =
      process.env.SENTRY_PROFILES_SAMPLE_RATE ??
      process.env.SENTRY_PROFILES_RATE ??
      '0.1';

    Sentry.init({
      dsn: rawDsn,
      environment: process.env.NODE_ENV || 'development',
      tracesSampleRate: Number(tracesRate),
      profilesSampleRate: Number(profilesRate),
    });
    _sentryInitialized = true;
    logger.info({ sentry: true }, 'Sentry initialized');
  } catch (e) {
    // Bad DSN or init error: disable gracefully
    logger.warn({ err: e?.message || String(e) }, 'Sentry init failed; disabling Sentry');
  }
}

// SAFE exports (no-op if Sentry is off)
export const sentryRequestHandler =
  SENTRY_ENABLED && _sentryInitialized && Sentry?.Handlers?.requestHandler
    ? Sentry.Handlers.requestHandler()
    : (_req, _res, next) => next();

export const sentryErrorHandler =
  SENTRY_ENABLED && _sentryInitialized && Sentry?.Handlers?.errorHandler
    ? Sentry.Handlers.errorHandler()
    : (err, _req, _res, next) => next(err);

/* ========================= Prometheus metrics ========================= */
export const metricsRegistry = new promClient.Registry();
promClient.collectDefaultMetrics({ register: metricsRegistry });

export const httpRequestsTotal = new promClient.Counter({
  name: 'http_requests_total',
  help: 'Total number of HTTP requests',
  labelNames: ['method', 'route', 'status'],
  registers: [metricsRegistry],
});

export const httpRequestDurationMs = new promClient.Histogram({
  name: 'http_request_duration_ms',
  help: 'HTTP request duration in ms',
  buckets: [10, 25, 50, 100, 200, 400, 800, 1600, 5000],
  labelNames: ['method', 'route', 'status'],
  registers: [metricsRegistry],
});

export const auditLogsTotal = new promClient.Counter({
  name: 'audit_logs_total',
  help: 'Total number of audit log entries written',
  labelNames: ['action', 'status'],
  registers: [metricsRegistry],
});

// Domain metrics (exported for other modules to use)
export const messagesSentTotal = new promClient.Counter({
  name: 'messages_sent_total',
  help: 'Total messages sent',
  labelNames: ['roomType'], // e.g., "direct" | "group" | "random"
  registers: [metricsRegistry],
});

export const wsConnectionsGauge = new promClient.Gauge({
  name: 'ws_connections',
  help: 'Active WebSocket connections',
  registers: [metricsRegistry],
});

export const activeRoomsGauge = new promClient.Gauge({
  name: 'active_rooms',
  help: 'Active chat rooms with at least one connected member',
  registers: [metricsRegistry],
});

// Convenience helpers for other modules (optional)
export const incMessagesSent = (roomType = 'unknown') =>
  messagesSentTotal.inc({ roomType });
export const setWsConnections = (n) => wsConnectionsGauge.set(n);
export const setActiveRooms = (n) => activeRoomsGauge.set(n);

// Express handler to expose /metrics
export async function metricsEndpoint(_req, res) {
  try {
    res.setHeader('Content-Type', metricsRegistry.contentType);
    res.end(await metricsRegistry.metrics());
  } catch (err) {
    logger.error({ err }, 'Failed to render /metrics');
    if (SENTRY_ENABLED && _sentryInitialized) Sentry.captureException(err);
    res.status(500).send('metrics error');
  }
}

/* ========================= Request ID & request logging ========================= */
export function requestId() {
  return (req, res, next) => {
    const existing = req.get('x-request-id');
    req.id = existing || randomUUID();
    res.setHeader('x-request-id', req.id);
    next();
  };
}

export function requestLogger() {
  return (req, res, next) => {
    // Use route pattern if available to reduce label cardinality
    const routeLabel = () => {
      const path = req.route?.path || req.baseUrl || req.originalUrl || 'unknown';
      return String(path)
        .replace(/\/\d+/g, '/:id')
        .replace(/[a-f0-9]{24}/gi, ':hex')
        .replace(/[a-f0-9-]{36}/gi, ':uuid');
    };

    const start = process.hrtime.bigint();
    const child = logger.child({
      requestId: req.id,
      method: req.method,
      route: routeLabel(),
    });
    req.log = child;

    child.info({ ip: req.ip }, 'HTTP request start');

    const done = () => {
      res.removeListener('finish', done);
      res.removeListener('close', done);
      const durationMs = Number(process.hrtime.bigint() - start) / 1e6;
      const status = res.statusCode;
      const route = routeLabel();

      httpRequestsTotal.inc({ method: req.method, route, status: String(status) });
      httpRequestDurationMs.observe(
        { method: req.method, route, status: String(status) },
        durationMs
      );

      child.info({ status, durationMs }, 'HTTP request end');
    };

    res.on('finish', done);
    res.on('close', done);
    next();
  };
}

/* ========================= Sensitive-field redaction ========================= */
const SENSITIVE_KEYS = new Set([
  'password',
  'pass',
  'pwd',
  'token',
  'access_token',
  'refresh_token',
  'authorization',
  'cookie',
  'set-cookie',
  'api_key',
  'apikey',
  'client_secret',
  'secret',
  'otp',
  'code',
]);

function redactValue(val) {
  if (val === null || val === undefined) return val;
  if (typeof val === 'string') return val.length ? '[REDACTED]' : val;
  if (typeof val === 'number' || typeof val === 'boolean') return '[REDACTED]';
  if (Array.isArray(val)) return val.map(() => '[REDACTED]');
  if (typeof val === 'object') return '[REDACTED]';
  return '[REDACTED]';
}

function deepRedact(obj, seen = new WeakSet()) {
  if (obj === null || obj === undefined) return obj;
  if (typeof obj !== 'object') return obj;
  if (seen.has(obj)) return '[CYCLE]';
  seen.add(obj);

  if (Array.isArray(obj)) return obj.map((v) => deepRedact(v, seen));

  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (SENSITIVE_KEYS.has(k.toLowerCase())) {
      out[k] = redactValue(v);
      continue;
    }
    if (typeof v === 'object' && v !== null) {
      out[k] = deepRedact(v, seen);
    } else {
      out[k] = v;
    }
  }
  return out;
}

function clampMetadataSize(meta, maxBytes = 16 * 1024) {
  try {
    const s = JSON.stringify(meta);
    if (s.length <= maxBytes) return meta;
    return { note: 'metadata truncated', approxBytes: s.length };
  } catch {
    return { note: 'metadata unstringifiable' };
  }
}

/* ========================= Audit middleware ========================= */
export function audit(action, { resource, resourceId, redactor } = {}) {
  return async (req, res, next) => {
    const startedAt = Date.now();

    const done = () => {
      res.removeListener('finish', done);
      res.removeListener('close', done);

      const status = res.statusCode;
      const ip =
        req.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
        req.socket?.remoteAddress ||
        null;
      const userAgent = req.get('user-agent') || null;

      let metadata = undefined;
      try {
        metadata = redactor ? redactor(req, res) : undefined;
      } catch (err) {
        logger.warn({ err }, 'audit redactor threw');
        if (SENTRY_ENABLED && _sentryInitialized) Sentry.captureException(err);
      }

      if (metadata && typeof metadata === 'object') {
        metadata = deepRedact(metadata);
        metadata = clampMetadataSize(metadata);
      }

      const actorId = req.user?.id;
      if (!actorId) return;

      import('../utils/prismaClient.js')
        .then(async ({ default: prisma }) => {
          try {
            await prisma.auditLog.create({
              data: {
                actorId,
                action,
                resource: resource || null,
                resourceId: resourceId?.toString() || null,
                status,
                ip,
                userAgent,
                requestId: req.id || null,
                durationMs: Date.now() - startedAt,
                metadata,
              },
            });
            auditLogsTotal.inc({ action, status: String(status) });
          } catch (err) {
            logger.error({ err, action, actorId, status }, 'failed to write audit log');
            if (SENTRY_ENABLED && _sentryInitialized) Sentry.captureException(err);
          }
        })
        .catch((err) => {
          logger.error({ err }, 'failed to import prisma for audit');
          if (SENTRY_ENABLED && _sentryInitialized) Sentry.captureException(err);
        });
    };

    res.on('finish', done);
    res.on('close', done);
    next();
  };
}
