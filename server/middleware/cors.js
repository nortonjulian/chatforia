import cors from 'cors';

function parseList(v) {
  return (v || '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);
}

export function createCorsForbiddenError() {
  const error = new Error(
    'Not allowed by CORS'
  );

  error.status = 403;
  error.statusCode = 403;
  error.code = 'CORS_ORIGIN_FORBIDDEN';

  return error;
}

export function corsConfigured() {
  const devOrigins = ['http://localhost:5173', 'http://127.0.0.1:5173'];
  const extra = parseList(process.env.CORS_EXTRA_ORIGINS);
  const prodApp = process.env.APP_ORIGIN ? [process.env.APP_ORIGIN] : [];

  const allowlist = [...new Set([...devOrigins, ...prodApp, ...extra])];

  return cors({
    origin(origin, cb) {
      // allow no Origin (curl/postman) and same-origin
      if (!origin) return cb(null, true);
      if (allowlist.includes(origin)) return cb(null, true);
      return cb(null, false);
    },
    credentials: true, // allow cookies
  });
}
