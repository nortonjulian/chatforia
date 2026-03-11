import Boom from '@hapi/boom';

export function notFoundHandler(req, res, next) {
  next(Boom.notFound());
}

export function errorHandler(err, req, res, _next) {
  const boomErr = Boom.isBoom(err)
    ? err
    : Boom.boomify(err, { statusCode: err.status || err.statusCode || 500 });

  const { statusCode, payload } = boomErr.output;

  const safeBody =
    req.body && typeof req.body === 'object'
      ? (Object.keys(req.body).length <= 20 ? req.body : '[large body]')
      : undefined;

  const logFields = {
    err,
    statusCode,
    route: req.originalUrl,
    method: req.method,
    params: req.params,
    query: req.query,
    body: safeBody,
    requestId: req.id,
  };

  const isApiRoute = req.originalUrl.startsWith('/api');
  const shouldSkipLog = statusCode === 404 && !isApiRoute;

  if (!shouldSkipLog) {
    if (statusCode >= 500) {
      req.log?.error(logFields, 'Request failed');
    } else {
      req.log?.warn(logFields, 'Request handled with client error');
    }
  }

  const body = boomErr.data ? { ...payload, data: boomErr.data } : payload;

  if (process.env.NODE_ENV === 'test' && statusCode >= 500) {
    body.__test = {
      message: String(err.message),
      stack: String(err.stack || '').split('\n').slice(0, 5),
    };
  }

  res.status(statusCode).json(body);
}