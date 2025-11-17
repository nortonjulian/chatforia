import {
  jest,
  describe,
  test,
  expect,
  beforeEach,
  afterAll,
} from '@jest/globals';
import express from 'express';
import request from 'supertest';

const ORIGINAL_ENV = process.env;

let prismaMock;
let envMock;

// ---- Mocks ----

// prisma client used by healthz
await jest.unstable_mockModule('../utils/prismaClient.js', () => {
  prismaMock = {
    $queryRaw: jest.fn(),
  };
  return {
    __esModule: true,
    default: prismaMock,
  };
});

// ENV config used by healthz
await jest.unstable_mockModule('../config/env.js', () => {
  envMock = {
    CORS_ORIGINS: ['https://app.chatforia.com', 'https://studio.chatforia.com'],
    FRONTEND_ORIGIN: 'https://app.chatforia.com',
    FORCE_HTTPS: true,
    COOKIE_SECURE: true,
    TELCO_PROVIDER: 'twilio',
    STRIPE_SECRET_KEY: 'sk_test_123',
    STRIPE_WEBHOOK_SECRET: 'whsec_123',
    SENTRY_DSN: 'https://sentry.example',
    UPLOAD_TARGET: 'r2',
    STATUS_ENABLED: true,
  };
  return {
    __esModule: true,
    ENV: envMock,
  };
});

// Import router AFTER mocks
const { default: healthzRouter } = await import('../routes/healthz.js');

// Build test app
const app = express();
app.use('/healthz', healthzRouter);

beforeEach(() => {
  jest.clearAllMocks();
  process.env = { ...ORIGINAL_ENV };
  delete process.env.REDIS_URL; // default to "no redis configured"
  process.env.GIT_COMMIT_SHA = 'test-sha-123';
});

afterAll(() => {
  process.env = ORIGINAL_ENV;
});

describe('GET /healthz', () => {
  test('returns 200 when DB is OK and Redis is not configured (treated as passing + skipped)', async () => {
    prismaMock.$queryRaw.mockResolvedValueOnce([{ '1': 1 }]);

    const res = await request(app).get('/healthz');

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);

    // DB check
    expect(prismaMock.$queryRaw).toHaveBeenCalledTimes(1);
    expect(res.body.checks.db).toEqual({ ok: true });

    // Redis: no REDIS_URL -> ok true + skipped
    expect(res.body.checks.redis.ok).toBe(true);
    expect(res.body.checks.redis.skipped).toBe(true);

    // Config snapshot derived from ENV
    expect(res.body.config).toEqual({
      https: true,
      cookieSecure: true,
      // 2 from CORS_ORIGINS (FRONTEND_ORIGIN is ignored when CORS_ORIGINS present)
      corsOrigins: 2,
      telco: 'twilio',
      stripe: true,
      sentry: true,
      uploads: 'r2',
      statusFeature: true,
    });

    // Some basic shape checks
    expect(typeof res.body.uptimeSec).toBe('number');
    expect(typeof res.body.durationMs).toBe('number');
    expect(res.body.version).toBe('test-sha-123');
    expect(typeof res.body.node).toBe('string');
    expect(typeof res.body.host).toBe('string');
  });

  test('returns 503 when DB check fails (Redis still treated as passing when not configured)', async () => {
    prismaMock.$queryRaw.mockRejectedValueOnce(new Error('db down'));

    const res = await request(app).get('/healthz');

    expect(res.status).toBe(503);
    expect(res.body.ok).toBe(false);

    expect(prismaMock.$queryRaw).toHaveBeenCalledTimes(1);

    // DB failure info
    expect(res.body.checks.db.ok).toBe(false);
    expect(res.body.checks.db.error).toBe('db down');

    // Redis again treated as ok + skipped
    expect(res.body.checks.redis.ok).toBe(true);
    expect(res.body.checks.redis.skipped).toBe(true);
  });
});
