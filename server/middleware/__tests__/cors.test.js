import { createCorsForbiddenError, appAllowedOrigins } from '../cors.js';

describe('CORS errors', () => {
  test('classifies a rejected origin as an expected 403', () => {
    const error = createCorsForbiddenError();

    expect(error).toBeInstanceOf(Error);
    expect(error.message).toBe('Not allowed by CORS');
    expect(error.status).toBe(403);
    expect(error.statusCode).toBe(403);
    expect(error.code).toBe('CORS_ORIGIN_FORBIDDEN');
  });
});

test('local server-rendered MFA origin is explicit and development-only', () => {
  const development = appAllowedOrigins({ isProd: false });
  const production = appAllowedOrigins({ isProd: true });
  expect(development).toContain('http://localhost:5002');
  expect(production).not.toContain('http://localhost:5002');
  expect(development.filter((origin) => !production.includes(origin))).toEqual([
    'http://localhost:5002',
  ]);
  for (const origin of [
    'http://untrusted.invalid',
    'http://localhost:5174',
    'null',
    '*',
  ]) {
    expect(development).not.toContain(origin);
    expect(production).not.toContain(origin);
  }
  expect(production).toEqual([
    'https://chatforia.com',
    'https://www.chatforia.com',
    'https://api.chatforia.com',
    'http://localhost:5173',
    'https://appleid.apple.com',
  ]);
});
