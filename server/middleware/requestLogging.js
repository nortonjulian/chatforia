import pinoHttp from 'pino-http';
import logger from '../utils/logger.js';
import { logSafeRequestPath } from '../utils/logSafeRequestPath.js';

/**
 * The production request logger, exposed as a factory so an HTTP regression
 * test can capture its real JSON output without loading the entire app.
 */
export function createRequestLoggingMiddleware({ logger: requestLogger = logger } = {}) {
  return pinoHttp({
    logger: requestLogger,
    autoLogging: true,
    serializers: {
      req: (req) => ({
        method: req.method,
        url: logSafeRequestPath(req.url),
        id: req.id,
      }),
      err: (e) => ({
        type: e?.name,
        message: e?.message,
        stack: e?.stack,
      }),
    },
    genReqId: (req) => req.id || Math.random().toString(36).slice(2),
    customProps: (req) => ({
      requestId: req.id,
      userId: req.user?.id ?? null,
      method: req.method,
      path: logSafeRequestPath(req.originalUrl || req.url),
      region: req.region || null,
    }),
    customLogLevel: (req, res, err) => {
      if (err || res.statusCode >= 500) return 'error';
      if (res.statusCode >= 400) return 'warn';
      return 'info';
    },
    redact: {
      paths: ['req.headers.authorization', 'req.headers.cookie', 'res.headers["set-cookie"]'],
    },
  });
}
