import csurf from 'csurf';

const NOOP = (_req, _res, next) => next();

// Authentication prefers the session cookie. A Bearer header must not disable
// CSRF when that cookie is the credential which will authorize the request.
export function csrfOnlyForCookieAuth(csrfMw) {
  return (req, res, next) => {
    const cookieToken = req.cookies?.[process.env.JWT_COOKIE_NAME || 'foria_jwt'];
    const hasBearer = /^Bearer\s+\S+\s*$/i.test(req.headers.authorization || '');
    return hasBearer && !cookieToken ? next() : csrfMw(req, res, next);
  };
}

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
          '',
      });

export default csrfDefault;
