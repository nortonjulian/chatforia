import 'dotenv/config';
import express from 'express';
import compression from 'compression';
import cookieParser from 'cookie-parser';
import rateLimit from 'express-rate-limit';
// import listEndpoints from 'express-list-endpoints';
import path from 'path';
import { fileURLToPath } from 'url';
import { initCrons } from './cron/index.js';
initCrons();

// Sentry + logging
import * as Sentry from '@sentry/node';
import { nodeProfilingIntegration } from '@sentry/profiling-node';
import { requestId } from './middleware/requestId.js';
import pinoHttp from 'pino-http';
import logger from './utils/logger.js';

// Deep health
import healthzRouter from './routes/healthz.js';

// Routers / middleware
import premiumRouter from './routes/premium.js';
import backupsRouter from './routes/backups.js';
import smsWebhooks from './routes/smsWebhooks.js';
import devicesRouter from './routes/devices.js';
import statusRoutes from './routes/status.js';
import authRouter from './routes/auth.js';
import usersRouter from './routes/users.js';
import messagesRouter from './routes/messages.js';
import callsRouter from './routes/calls.js';
import roomsRouter from './routes/rooms.js';
import followsRouter from './routes/follows.js';
import randomChatsRouter from './routes/randomChats.js';
import contactRoutes from './routes/contacts.js';
import invitesRouter from './routes/invites.js';
import mediaRouter from './routes/media.js';
import billingRouter from './routes/billing.js';
import billingWebhook from './routes/billingWebhook.js';
import contactsImportRouter from './routes/contactsImport.js';
import uploadsRouter from './routes/uploads.js';
import smsRouter from './routes/sms.js';
import voiceRouter from './routes/voice.js';
import settingsForwardingRouter from './routes/settings.forwarding.js';
import calendarRouter from './routes/calendar.js';
import shareEventRouter from './routes/shareEvent.js';
import eventLinksRouter from './routes/eventLinks.js';
import a11yRouter from './routes/a11y.js';
import translationsRouter from './routes/translations.js';
import storiesRouter from './routes/stories.js';
import numbersRouter from './routes/numbers.js'; 

// 🔒 auth gates
import { requireAuth } from './middleware/auth.js';
// ✅ enforcement gates
import {
  requirePhoneVerified,
  requireStaff2FA,
  requirePremium, 
} from './middleware/enforcement.js';

// ✅ auth sub-routers
import { router as emailVerification } from './routes/auth/emailVerification.js';
import { router as phoneVerification } from './routes/auth/phoneVerification.js';
import { router as mfaTotp } from './routes/auth/mfaTotp.js';

// Errors
import { notFoundHandler, errorHandler } from './middleware/errorHandler.js';

// CSRF + Rate limiters
import { buildCsrf, setCsrfCookie } from './middleware/csrf.js';
import {
  limiterLogin,
  limiterRegister,
  limiterReset,
  limiterInvites,
  limiterAI,
  limiterMedia,
  limiterGenericMutations,
} from './middleware/rateLimits.js';

// Security middlewares
import { corsConfigured } from './middleware/cors.js';
import { secureHeaders } from './middleware/secureHeaders.js';
import { csp } from './middleware/csp.js';
import { hppGuard } from './middleware/hpp.js';
import { httpsRedirect } from './middleware/httpsRedirect.js';

// Session + passport + oauth routes
import session from 'express-session';
import passport from './auth/passport.js';
import oauthRouter from './routes/oauth.routes.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export function createApp() {
  const app = express();
  const isProd = process.env.NODE_ENV === 'production';
  const isTest = process.env.NODE_ENV === 'test';

  app.set('trust proxy', true);

  /* Early security */
  app.use(httpsRedirect());
  app.use(corsConfigured());
  app.use(secureHeaders());
  app.use(csp());

  /* Stripe webhook (raw) */
  app.post('/billing/webhook', express.raw({ type: 'application/json' }), (req, res, next) => {
    next('route');
  });

  /* Core middleware */
  app.use(cookieParser());
  app.use(compression());
  app.use(requestId());
  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: true, limit: '512kb' }));

  // Auto XHR header in tests/dev fallbacks
  const AUTO_XHR =
    isTest || String(process.env.DEV_FALLBACKS || '').toLowerCase() === 'true';
  if (AUTO_XHR) {
    app.use((req, _res, next) => {
      const m = req.method.toUpperCase();
      if (
        (m === 'POST' || m === 'PUT' || m === 'PATCH' || m === 'DELETE') &&
        !req.get('x-requested-with')
      ) {
        req.headers['x-requested-with'] = 'XMLHttpRequest';
      }
      next();
    });
  }

  app.use(hppGuard({ allow: ['tags', 'ids'] }));

  app.use(
    pinoHttp({
      logger,
      autoLogging: true,
      genReqId: (req) => req.id,
      customProps: (req) => ({
        requestId: req.id,
        userId: req.user?.id ?? null,
        method: req.method,
        path: req.originalUrl || req.url,
      }),
      customLogLevel: (req, res, err) => {
        if (err || res.statusCode >= 500) return 'error';
        if (res.statusCode >= 400) return 'warn';
        return 'info';
      },
      redact: {
        paths: [
          'req.headers.authorization',
          'req.headers.cookie',
          'res.headers["set-cookie"]',
        ],
      },
    })
  );

  /* Sentry (prod only) */
  if (isProd) {
    Sentry.init({
      dsn: process.env.SENTRY_DSN,
      environment: process.env.NODE_ENV || 'dev',
      release: process.env.COMMIT_SHA,
      integrations: [nodeProfilingIntegration()],
      tracesSampleRate: Number(process.env.SENTRY_TRACES_RATE ?? 0.2),
      profilesSampleRate: Number(process.env.SENTRY_PROFILES_RATE ?? 0.1),
      beforeSend(event) {
        if (event.request) {
          delete event.request.headers?.cookie;
          delete event.request.headers?.authorization;
        }
        return event;
      },
    });
    app.use(Sentry.Handlers.requestHandler());
    app.use(Sentry.Handlers.tracingHandler());
  }

  /* ---------- Session + Passport (must be before OAuth routes) ---------- */
  app.use(
    session({
      secret: process.env.SESSION_SECRET || 'change-me',
      resave: false,
      saveUninitialized: false,
      cookie: {
        sameSite: isProd ? 'none' : 'lax',
        secure: isProd,
      },
    })
  );
  app.use(passport.initialize());

  /* CSRF */
  const csrfMw = isTest
    ? (_req, _res, next) => next()
    : buildCsrf({ isProd, cookieDomain: process.env.COOKIE_DOMAIN });

  // TEMP bypasses for first-run auth flows (remove later!)
  const CSRF_BYPASS = new Set([
    '/billing/webhook',
    '/auth/apple/callback',
    '/auth/register',
    '/auth/login',
  ]);

  app.use((req, res, next) => {
    if (CSRF_BYPASS.has(req.path)) return next();
    return csrfMw(req, res, next);
  });

  if (!isTest) {
    app.use((req, res, next) => {
      if (req.method === 'GET') setCsrfCookie(req, res);
      next();
    });
  }
  app.get('/auth/csrf', (req, res) => {
    setCsrfCookie(req, res);
    res.json({ csrfToken: req.csrfToken() });
  });

  /* Health */
  app.get('/health', (_req, res) => res.json({ ok: true }));
  app.use('/healthz', healthzRouter);

  /* Rate limiters (disabled in tests) */
  const PASS = (_req, _res, next) => next();
  const RL = (mw) => (isTest ? PASS : mw);

  app.use(['/auth/login', '/auth/2fa'], RL(limiterLogin));
  app.use('/auth/register', RL(limiterRegister));
  app.use(['/auth/forgot-password', '/auth/reset-password'], RL(limiterReset));
  app.use('/invites', RL(limiterInvites));
  app.use('/ai', RL(limiterAI));
  app.use('/media', RL(limiterMedia));
  app.use((req, res, next) => {
    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
      return RL(limiterGenericMutations)(req, res, next);
    }
    next();
  });

  /* Base routes */
  app.get('/', (_req, res) => res.send('Welcome to Chatforia API!'));

  // Webhook + Billing (UI/API under /billing requires staff 2FA)
  app.use('/billing', billingWebhook);
  app.use('/billing', requireAuth, requireStaff2FA, billingRouter);

  // OAuth under /auth
  app.use('/auth', oauthRouter);

  // Auth sub-routers before primary auth
  app.use('/auth', emailVerification);                        // /auth/email/*
  app.use('/auth/phone', requireAuth, phoneVerification);     // /auth/phone/*
  app.use('/auth/2fa', requireAuth, mfaTotp);                 // /auth/2fa/*

  // Primary auth API
  app.use('/auth', authRouter);

  app.use('/users', usersRouter);

  // Inbound SMS webhooks (ungated)
  app.use('/webhooks/sms', smsWebhooks);

  // PSTN/telephony surfaces (require phone verification)
  app.use('/voice', requireAuth, requirePhoneVerified, voiceRouter);
  app.use('/calls', requireAuth, requirePhoneVerified, callsRouter);
  app.use('/sms', requireAuth, requirePhoneVerified, smsRouter);

  // 🔢 Numbers API: gate entire router; also pre-guard /numbers/lock with Premium
  app.post('/numbers/lock',
    requireAuth,
    requirePhoneVerified,
    requirePremium,
    (req, _res, next) => next() // forward to the router handler
  );
  app.use('/numbers', requireAuth, requirePhoneVerified, numbersRouter);

  app.use('/rooms', roomsRouter);
  app.use('/chatrooms', roomsRouter);
  app.use('/messages', messagesRouter);

  app.use(a11yRouter);

  app.use('/follows', followsRouter);
  app.use('/random-chats', randomChatsRouter);
  app.use('/contacts', contactRoutes);
  app.use('/invites', invitesRouter);
  app.use('/media', mediaRouter);
  app.use('/devices', devicesRouter);

  // Backups require auth
  app.use('/backups', requireAuth, backupsRouter);

  app.use('/uploads', uploadsRouter);
  app.use('/settings', settingsForwardingRouter);
  app.use('/premium', premiumRouter);
  app.use('/translations', translationsRouter);
  app.use('/stories', storiesRouter);

  // Contacts bulk import (under /api to match Vite proxy)
  app.use('/api', contactsImportRouter);

  app.use('/calendar', calendarRouter);
  app.use('/', shareEventRouter);
  app.use('/', eventLinksRouter);

  /* Status flag */
  const STATUS_ENABLED_FLAG = String(process.env.STATUS_ENABLED || '').toLowerCase() === 'true';
  const STATUS_ENABLED = isTest ? true : STATUS_ENABLED_FLAG;
  logger.info(
    { service: 'chatforia-server', env: process.env.NODE_ENV, STATUS_ENABLED },
    'Status routes feature flag'
  );
  if (STATUS_ENABLED) {
    const isLoad = process.env.NODE_ENV === 'loadtest' || process.env.LOADTEST === '1';
    const RL_HUGE = 100000;
    const statusReadLimiter = rateLimit({
      windowMs: 60 * 1000,
      max: isLoad ? RL_HUGE : 60,
      standardHeaders: true,
      legacyHeaders: false,
    });
    app.use('/status', statusReadLimiter);
    app.use('/status', statusRoutes);
  }

  /* Errors */
  if (isProd) {
    app.use(Sentry.Handlers.errorHandler());
  }
  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}

const app = createApp();
export default app;
