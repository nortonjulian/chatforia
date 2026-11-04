import { writeFileSync } from 'node:fs';
import cookie from 'cookie';
import Tokens from 'csrf';

// Opt-in, synthetic-harness-only metadata. Never write cookie/header/body values.
export function installOauthDiagnostics(app, file) {
  if (
    process.env.STAFF_GOOGLE_OAUTH !== 'isolated-synthetic-only' ||
    process.env.NODE_ENV !== 'development'
  )
    throw Error('Diagnostics require isolated OAuth harness');
  const tokens = new Tokens();
  const records = [];
  app.use((req, res, next) => {
    const path = (req.originalUrl || req.url).split('?')[0];
    if (
      !['/auth/csrf', '/auth/2fa/login', '/auth/2fa/challenge'].includes(path)
    )
      return next();
    let category = 'other';
    const original = res.json;
    res.json = function (body) {
      category =
        body?.reason === 'csrf'
          ? 'csrf'
          : body?.error === 'Forbidden'
            ? 'cors-forbidden'
            : body?.ok === true
              ? 'ok'
              : 'other';
      return original.call(this, body);
    };
    res.once('finish', () => {
      const parsed = cookie.parse(req.headers.cookie || '');
      const header = req.headers['x-csrf-token'] || req.headers['x-xsrf-token'];
      const pending = parsed.cf_mfa_pending;
      const record = {
        at: new Date().toISOString(),
        method: req.method,
        path,
        status: res.statusCode,
        category,
        originIsApi: req.headers.origin === 'http://localhost:5002',
        originIsFrontend: req.headers.origin === 'http://localhost:5173',
        pendingCookiePresent: Boolean(pending),
        sessionCookiePresent: Boolean(
          parsed[process.env.JWT_COOKIE_NAME || 'foria_jwt']
        ),
        csrfSecretCookiePresent: Boolean(parsed._csrf),
        xsrfCookiePresent: Boolean(parsed['XSRF-TOKEN']),
        csrfHeaderPresent: Boolean(header),
        csrfHeaderValid: Boolean(
          parsed._csrf &&
            typeof header === 'string' &&
            tokens.verify(parsed._csrf, header)
        ),
        csrfMiddlewareReached: typeof req.csrfToken === 'function',
        browserMfaRequested: req.body?.browserMfa === true,
        pendingMatchesBody: Boolean(
          pending && req.body?.mfaToken && pending === req.body.mfaToken
        ),
      };
      records.push(record);
      if (records.length > 40) records.shift();
      writeFileSync(file, JSON.stringify(records, null, 2), { mode: 0o600 });
    });
    next();
  });
  // Outer harness middleware only; retain all original CORS/CSRF/auth handlers.
  const stack = app._router?.stack || app.router?.stack;
  if (!Array.isArray(stack)) throw Error('Unsupported local harness router');
  const layer = stack.pop();
  stack.unshift(layer);
  writeFileSync(file, JSON.stringify(records), { mode: 0o600 });
}
