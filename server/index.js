import 'dotenv/config';
import http from 'http';
import { createApp } from './app.js';
import { initSocket } from './socket.js';
import { startCleanupJobs, stopCleanupJobs } from './cron/cleanup.js';

import validateEnv from './config/validateEnv.js';
import { ENV } from './config/env.js';
import logger from './utils/logger.js';

/** Build the express app instance (exported for tests) */
export function makeApp() {
  const app = createApp();

  // Route dumper for tests/dev introspection (lightweight)
  app.get('/__routes_dump', (req, res) => {
    const layers = app._router?.stack || [];
    const hasStatusRouter = layers.some((layer) => {
      if (layer?.name === 'router' && layer?.regexp) return String(layer.regexp).includes('^\\/status');
      if (layer?.route?.path === '/status') return true;
      return false;
    });
    res.json({ statusFlag: String(process.env.STATUS_ENABLED || ''), hasStatusRouter });
  });

  return app;
}

// Global hardening: crash fast on programmer errors in prod (so orchestrator restarts us)
process.on('unhandledRejection', (err) => {
  logger.error({ err }, '[unhandledRejection]');
  if (ENV.IS_PROD) process.exit(1);
});
process.on('uncaughtException', (err) => {
  logger.error({ err }, '[uncaughtException]');
  if (ENV.IS_PROD) process.exit(1);
});

// Fail fast if misconfigured (throws on missing/unsafe env combos)
validateEnv();

if (ENV.IS_TEST) {
  // In tests we only export the factory; the test harness will call makeApp()
  logger.info({ env: ENV.NODE_ENV }, 'Loaded server in test mode (no listener)');
} else {
  const app = makeApp();
  const server = http.createServer(app);

  // Wire Socket.IO (and stash helpers on app for routes/services)
  const { io, emitToUser, close: closeSockets } = initSocket(server);
  app.set('io', io);
  app.set('emitToUser', emitToUser);

  // Start background cleanup cron
  try {
    startCleanupJobs();
    logger.info('Cleanup jobs started');
  } catch (e) {
    logger.warn({ err: e }, 'Failed to start cleanup jobs');
  }

  // Start HTTP
  server.listen(ENV.PORT, () => {
    logger.info({ port: ENV.PORT, env: ENV.NODE_ENV }, '🚀 Chatforia server listening');
  });

  // Graceful shutdown
  async function shutdown(sig) {
    logger.warn({ sig }, 'Shutting down...');

    // Stop cron tasks first to avoid new work
    try {
      stopCleanupJobs();
      logger.info('Cleanup jobs stopped');
    } catch (e) {
      logger.warn({ err: e }, 'Cleanup stop error');
    }

    // Close websockets/redis adapter
    try {
      if (closeSockets) await closeSockets();
      logger.info('Socket layer closed');
    } catch (e) {
      logger.warn({ err: e }, 'Socket close error');
    }

    // Disconnect Prisma
    try {
      const { default: prisma } = await import('./utils/prismaClient.js');
      await prisma.$disconnect?.();
      logger.info('Prisma disconnected');
    } catch (e) {
      logger.warn({ err: e }, 'Prisma disconnect error');
    }

    // Close HTTP server
    await new Promise((resolve) => server.close(resolve));

    // Safety exit if close hangs
    setTimeout(() => process.exit(0), 5000).unref();
  }

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}
