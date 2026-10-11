import express from 'express';
import os from 'node:os';
import prisma from '../utils/prismaClient.js';
import { ENV } from '../config/env.js';

let redisClient = null;
async function getRedis() {
  if (redisClient !== null) return redisClient;
  if (!process.env.REDIS_URL) return null;
  const { default: IoRedis } = await import('ioredis');
  redisClient = new IoRedis(process.env.REDIS_URL, { lazyConnect: true });
  try {
    await redisClient.connect?.();
  } catch {}
  return redisClient;
}

const router = express.Router();

router.get('/', async (_req, res) => {
  const startedAt = Date.now();
  const checks = { db: { ok: false }, redis: { ok: true } };

  // DB check
  try {
    await prisma.$queryRaw`SELECT 1`;
    checks.db.ok = true;
  } catch (e) {
    checks.db.ok = false;
    checks.db.error = e.message;
  }

  // Redis check (optional)
  try {
    const r = await getRedis();
    if (r) {
      const t0 = Date.now();
      const pong = await r.ping();
      checks.redis.ok = pong === 'PONG';
      checks.redis.latencyMs = Date.now() - t0;
    } else {
      checks.redis.ok = true; // treat as passing if not configured
      checks.redis.skipped = true;
    }
  } catch (e) {
    checks.redis.ok = false;
    checks.redis.error = e.message;
  }

  // Build safe config snapshot (no secrets)
  const corsOriginsCount =
    (ENV.CORS_ORIGINS && ENV.CORS_ORIGINS.length) ||
    (ENV.FRONTEND_ORIGIN ? 1 : 0);

  const objectStorage =
    ENV.FEATURE_R2 || (ENV.R2_BUCKET && ENV.R2_S3_ENDPOINT)
      ? 'r2'
      : 'local';

  const config = {
    https: ENV.FORCE_HTTPS,
    cookieSecure: ENV.COOKIE_SECURE,
    corsOrigins: corsOriginsCount,
    telco: ENV.DEFAULT_PROVIDER || 'none',
    stripe: Boolean(ENV.STRIPE_SECRET_KEY && ENV.STRIPE_WEBHOOK_SECRET),
    sentry: Boolean(ENV.SENTRY_DSN),
    uploads: ENV.UPLOAD_TARGET,
    objectStorage,
    statusFeature: ENV.STATUS_ENABLED,
  };

  const ok = Object.values(checks).every((c) => c.ok);
  const status = ok ? 200 : 503;

  res.status(status).json({
    ok,
    uptimeSec: Math.round(process.uptime()),
    durationMs: Date.now() - startedAt,
    version: process.env.GIT_COMMIT_SHA || 'dev',
    node: process.version,
    host: os.hostname(),
    checks,
    config,
  });
});

export default router;
