import 'dotenv/config';
import http from 'http';
import { createApp } from './app.js';
import { initSocket } from './socket.js';
import { startCleanupJobs, stopCleanupJobs } from './cron/cleanup.js';
import { initCrons } from './cron/index.js'; // moved here from app.js

import { startNumberLifecycleJob } from './jobs/numberLifecycle.js';
import { startMessageRetentionJob } from './jobs/messageRetention.js';

import validateEnv from './config/validateEnv.js';
import { ENV } from './config/env.js';
import logger from './utils/logger.js';

/**
 * Build the express app instance (exported for tests)
 * This uses createApp() from app.js, which should now be PURE:
 * - no app.listen()
 * - no initCrons()
 * - no long-lived timers
 */
export function makeApp() {
  const app = createApp();

  // Route dumper for tests/dev introspection (lightweight)
  app.get('/__routes_dump', (req, res) => {
    const layers = app._router?.stack || [];
    const hasStatusRouter = layers.some((layer) => {
      if (layer?.name === 'router' && layer?.regexp)
        return String(layer.regexp).includes('^\\/status');
      if (layer?.route?.path === '/status') return true;
      return false;
    });
    res.json({
      statusFlag: String(process.env.STATUS_ENABLED || ''),
      hasStatusRouter,
    });
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
// ⚠️ In test mode, skip strict validation to avoid requiring prod env vars.
if (!ENV.IS_TEST) {
  validateEnv();
}

if (ENV.IS_TEST) {
  // In tests we only export makeApp(); Jest will import app.js directly
  // or call makeApp() if it wants an isolated instance.
  logger.info({ env: ENV.NODE_ENV }, 'Loaded server in test mode (no listener)');
} else {
  // ---- REAL RUNTIME (dev/prod) ----
  const app = makeApp();
  const server = http.createServer(app);

  // Start cron jobs (ONLY in real runtime, NOT in tests)
  try {
    initCrons();
    logger.info('Cron jobs started');
  } catch (e) {
    logger.warn({ err: e }, 'Cron init failed');
  }

    // Start number lifecycle + message retention jobs
  try {
    startNumberLifecycleJob();
    startMessageRetentionJob();
    logger.info('Number lifecycle + message retention jobs started');
  } catch (e) {
    logger.warn({ err: e }, 'Failed to start number/message jobs');
  }

  // Wire up Socket.IO and stash helpers so routes/services can emit
  const { io, emitToUser, close: closeSockets } = initSocket(server);
  app.set('io', io);
  app.set('emitToUser', emitToUser);

  // Start background cleanup cron (auto-delete expired messages, etc.)
  try {
    startCleanupJobs();
    logger.info('Cleanup jobs started');
  } catch (e) {
    logger.warn({ err: e }, 'Failed to start cleanup jobs');
  }

  // Start HTTP server
  server.listen(ENV.PORT, () => {
    logger.info(
      { port: ENV.PORT, env: ENV.NODE_ENV },
      '🚀 Chatforia server listening'
    );
  });

  // Log hard server errors (EADDRINUSE, EACCES, etc.)
  server.on('error', (err) => {
    logger.error({ err }, 'HTTP server error');
    // Let process-level handlers decide on exit; in prod you typically crash to be restarted.
  });

  // Graceful shutdown
  async function shutdown(sig) {
    logger.warn({ sig }, 'Shutting down...');

    // Stop cron tasks first so no new work is scheduled
    try {
      stopCleanupJobs();
      logger.info('Cleanup jobs stopped');
    } catch (e) {
      logger.warn({ err: e }, 'Cleanup stop error');
    }

    // Close websockets / Socket.IO adapters
    try {
      if (closeSockets) await closeSockets();
      logger.info('Socket layer closed');
    } catch (e) {
      logger.warn({ err: e }, 'Socket close error');
    }

    // Disconnect Prisma (DB pool)
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

  // Nodemon/pm2 reloads sometimes send SIGUSR2
  process.on('SIGUSR2', async () => {
    await shutdown('SIGUSR2');
    process.kill(process.pid, 'SIGUSR2'); // hand control back to nodemon
  });
}
