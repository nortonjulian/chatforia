import csurf from 'csurf';

const NOOP = (_req, _res, next) => next();

export function buildCsrf({ isProd = process.env.NODE_ENV === 'production', cookieDomain } = {}) {
  if (process.env.NODE_ENV === 'test') return NOOP;

  return csurf({
    cookie: {
      httpOnly: true,          // secret cookie for csurf
      secure: isProd,          // false on localhost
      sameSite: 'lax',         // works with Vite proxy (same-origin)
      ...(isProd && cookieDomain ? { domain: cookieDomain } : {}),
      path: '/',
    },
    value: (req) =>
      req.get?.('x-csrf-token') ||
      req.headers?.['x-csrf-token'] ||
      req.headers?.['x-xsrf-token'] ||
      req.body?._csrf ||
      req.query?._csrf ||
      req.cookies?.['XSRF-TOKEN'] ||
      '',
  });
}

export function setCsrfCookie(req, res) {
  if (process.env.NODE_ENV === 'test') return;
  if (typeof req.csrfToken !== 'function') return;

  const token = req.csrfToken();
  const isProd = process.env.NODE_ENV === 'production';

  res.cookie('XSRF-TOKEN', token, {
    httpOnly: false,           // readable by client JS
    secure: isProd,            // false on localhost
    sameSite: 'lax',
    ...(isProd && process.env.COOKIE_DOMAIN ? { domain: process.env.COOKIE_DOMAIN } : {}),
    path: '/',
    maxAge: 2 * 60 * 60 * 1000,
  });
}

const csrfDefault =
  process.env.NODE_ENV === 'test'
    ? NOOP
    : csurf({
        cookie: {
          httpOnly: true,
          secure: process.env.NODE_ENV === 'production',
          sameSite: 'lax',
          ...(process.env.NODE_ENV === 'production' && process.env.COOKIE_DOMAIN
            ? { domain: process.env.COOKIE_DOMAIN }
            : {}),
          path: '/',
        },
        value: (req) =>
          req.get?.('x-csrf-token') ||
          req.headers?.['x-csrf-token'] ||
          req.headers?.['x-xsrf-token'] ||
          req.body?._csrf ||
          req.query?._csrf ||
          req.cookies?.['XSRF-TOKEN'] ||
          '',
      });

export default csrfDefault;
