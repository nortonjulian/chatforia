import Boom from '@hapi/boom';

export function notFoundHandler(req, res, next) {
  next(Boom.notFound('Route not found'));
}

export function errorHandler(err, req, res, _next) {
  // Normalize to Boom
  const boomErr = Boom.isBoom(err)
    ? err
    : Boom.boomify(err, { statusCode: err.status || err.statusCode || 500 });

  const { statusCode, payload } = boomErr.output;

  // Build safe context (avoid dumping huge bodies or secrets)
  const safeBody =
    req.body && typeof req.body === 'object'
      ? (Object.keys(req.body).length <= 20 ? req.body : '[large body]')
      : undefined;

  const logFields = {
    err, // pino will use serializer if you configured one
    statusCode,
    route: req.originalUrl,
    method: req.method,
    params: req.params,
    query: req.query,
    body: safeBody,
    requestId: req.id,
  };

  // 4xx -> warn; 5xx -> error
  if (statusCode >= 500) {
    req.log?.error(logFields, 'Request failed');
  } else {
    req.log?.warn(logFields, 'Request handled with client error');
  }

  // Optional: attach structured data (e.g., validation details)
  const body = boomErr.data ? { ...payload, data: boomErr.data } : payload;

  // In tests, surface a bit more detail for debugging
  if (process.env.NODE_ENV === 'test' && statusCode >= 500) {
    body.__test = {
      message: String(err.message),
      stack: String(err.stack || '').split('\n').slice(0, 5),
    };
  }

  res.status(statusCode).json(body);
}
