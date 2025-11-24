import 'dotenv/config';
import express from 'express';
import compression from 'compression';
import cookieParser from 'cookie-parser';
import rateLimit from 'express-rate-limit';
// import listEndpoints from 'express-list-endpoints';
import path from 'path';
import { fileURLToPath } from 'url';

// SAFE Sentry wrappers (no-op when DSN is missing/invalid)
import { sentryRequestHandler, sentryErrorHandler } from './middleware/audit.js';

import { startTealUsageWorker } from './jobs/tealSync.js';

// Request ID + logging
import { requestId } from './middleware/requestId.js';
import pinoHttp from 'pino-http';
import logger from './utils/logger.js';

import smsDevRouter from './routes/smsDev.js';
import smsDevMock from './routes/smsDevMock.js';
import smsDevInbound from './routes/smsDevInbound.js';

// Deep health
import healthzRouter from './routes/healthz.js';

import supportRouter from './routes/support.js';
import adsRouter from './routes/ads.js';

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
import billingRouter from './routes/billing.js';              // ✅ single billing router
// import billingWebhook from './routes/billingWebhook.js';    // ❌ removed (now unified)
import contactsImportRouter from './routes/contactsImport.js';
import uploadsRouter from './routes/uploads.js';
import smsRouter from './routes/sms.js';
import smsThreadsRouter from './routes/smsThreads.js';
import searchPeopleRouter from './routes/search.people.js';
import voiceRouter from './routes/voice.js';
import settingsForwardingRouter from './routes/settings.forwarding.js';
import calendarRouter from './routes/calendar.js';
import shareEventRouter from './routes/shareEvent.js';
import eventLinksRouter from './routes/eventLinks.js';
import a11yRouter from './routes/a11y.js';
import translationsRouter from './routes/translations.js';
import languagesRouter from './routes/languages.js';
import storiesRouter from './routes/stories.js';
import numbersRouter from './routes/numbers.js';
import voiceWebhooks from './routes/voiceWebhooks.js';
import videoTokens from './routes/videoTokens.js';
import connectivityRouter from './routes/connectivity.js';
import esimRouter from './routes/esim.js';
import simsRouter from './routes/sims.js'; // only if FEATURE_PHYSICAL_SIM
import pricingRouter from './routes/pricing.js';
import transcriptsRouter from './routes/transcripts.js';

import familyRouter from './routes/family.js';
import wirelessRouter from './routes/wireless.js';

import voicemailRouter from './routes/voicemail.js';
import voicemailGreetingRouter from './routes/voicemailGreeting.js';


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

// 🌍 region inference (for phone parsing defaults, etc.)
import { inferRegion } from './middleware/region.js';

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
import cors from 'cors';
import { secureHeaders } from './middleware/secureHeaders.js';
import { csp } from './middleware/csp.js';
import { hppGuard } from './middleware/hpp.js';
import { httpsRedirect } from './middleware/httpsRedirect.js';

// Session + passport + oauth routes
import session from 'express-session';
import passport from './auth/passport.js';
import oauthRouter from './routes/oauth.routes.js';

// eSIM feature flag
import { ESIM_ENABLED } from './config/esim.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export function createApp() {
  const app = express();
  const isProd = process.env.NODE_ENV === 'production';
  const isTest = process.env.NODE_ENV === 'test';

  // For your current setup (frontend :5173, API :5002) we want
  // cookies to be cross-site so the session is sent with XHR.
  const useCrossSiteCookies = true;

  // 🔄 Start Teal usage background worker (no-op unless ENABLE_TEAL_SYNC === "true")
  // You can comment this out if you want to postpone enabling it entirely.
  startTealUsageWorker();

  app.set('trust proxy', true);

  /* Early security */
  app.use(httpsRedirect());

  app.use(cors({
    origin: 'http://localhost:5173',
    credentials: true,
  }));

  app.use(secureHeaders());
  app.use(csp());

  /* -------------------------------------------------
   * Stripe webhook: MUST receive raw Buffer body
   * -------------------------------------------------*/
  app.use('/billing/webhook', express.raw({ type: 'application/json' }));

  /* Core middleware (after webhook raw) */
  app.use(cookieParser());
  app.use(compression());
  app.use(requestId());
  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: true, limit: '512kb' }));

  // 🌍 Make region available to all downstream routes (uses Accept-Language)
  app.use(inferRegion);

  // Attach Sentry request handler early (no-op if Sentry is disabled)
  if (isProd) {
    app.use(sentryRequestHandler);
  }

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
      serializers: {
        err: (e) => ({
          type: e?.name,
          message: e?.message,
          stack: e?.stack,
        }),
      },
      genReqId: (req) => req.id || Math.random().toString(36).slice(2),
      customProps: (req) => ({
        requestId: req.id,
        userId: req.user?.id ?? null,
        method: req.method,
        path: req.originalUrl || req.url,
        region: req.region || null,
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

  /* ---------- Session + Passport (must be before OAuth routes) ---------- */
  app.use(
    session({
      secret: process.env.SESSION_SECRET || 'change-me',
      resave: false,
      saveUninitialized: false,
      cookie: {
        // Cross-site so 5173 → 5002 requests include the cookie.
        sameSite: useCrossSiteCookies ? 'none' : 'lax',
        // In real production (HTTPS) this must be true.
        // For http://localhost dev it's OK to be false.
        secure: isProd ? true : false,
        // domain: process.env.COOKIE_DOMAIN, // e.g. ".chatforia.com" in real prod
      },
    })
  );
  app.use(passport.initialize());
  app.use(passport.session());

  // Optional debug logging
  app.use((req, _res, next) => {
    console.log('💡 After passport.session:', req.user && req.user);
    next();
  });

  /* CSRF */
  const csrfMw = isTest
    ? (_req, _res, next) => next()
    : buildCsrf({ isProd, cookieDomain: process.env.COOKIE_DOMAIN });

  // TEMP bypasses for first-run auth flows (remove later!)
  // + Teal webhook bypass
  const csrfBypassPattern =
    /^\/auth\/(login|register|logout|apple\/callback)$|^\/billing\/webhook$|^\/billing\/portal$|^\/esim\/webhooks\/teal$|^\/voice\/(inbound|voicemail|voicemail\/save)$/;

  app.use((req, res, next) => {
    const path = req.path;
    if (csrfBypassPattern.test(path)) {
      console.log('⚠️ CSRF bypass for:', path);
      return next();
    }
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

  /* -------------------------------------------
   * Billing: unified router
   *  - /billing/webhook uses raw body (set above)
   *  - Other /billing routes use JSON body
   *  - Each endpoint in billing.js does its own auth check
   * -------------------------------------------*/
  app.use('/billing', billingRouter);

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
  // PSTN/telephony surfaces (require phone verification for some routes)
  app.use('/voice', voiceRouter);

  app.use('/calls', requireAuth, requirePhoneVerified, callsRouter);
  app.use('/calls', requireAuth, requirePhoneVerified, callsRouter);
  app.use('/sms', requireAuth, requirePhoneVerified, smsRouter);
  app.use('/sms/threads', requireAuth, smsThreadsRouter);
  app.use('/search/people', requireAuth, searchPeopleRouter);
  app.use('/webhooks/voice', voiceWebhooks);
  app.use('/api', videoTokens);
  app.use('/pricing', pricingRouter);

  app.use('/api/voicemail', voicemailRouter);
  app.use('/api/voicemail/greeting', voicemailGreetingRouter);

  app.use('/support', supportRouter);

  app.use('/ads', adsRouter);

  // 🔢 Numbers API: gate entire router; also pre-guard /numbers/lock with Premium
  app.post(
    '/numbers/lock',
    requireAuth,
    requirePhoneVerified,
    requirePremium,
    (req, _res, next) => next()
  );
  app.use('/numbers', requireAuth, requirePhoneVerified, numbersRouter);

  app.use('/rooms', roomsRouter);
  app.use('/chatrooms', roomsRouter);
  app.use('/messages', messagesRouter);

  app.use(a11yRouter);

  app.use('/follows', followsRouter);
  app.use('/random-chats', randomChatsRouter);
  app.use(['/contacts', '/api/contacts'], contactRoutes);
  app.use(['/invites', '/api/invites'], RL(limiterInvites));
  app.use(['/invites', '/api/invites'], invitesRouter);
  app.use('/media', mediaRouter);
  app.use('/devices', devicesRouter);
  app.use('/', transcriptsRouter);

  // Backups require auth
  app.use('/backups', requireAuth, backupsRouter);

  app.use('/uploads', uploadsRouter);
  app.use('/settings', settingsForwardingRouter);
  app.use('/premium', premiumRouter);
  app.use('/api/translations', translationsRouter);
  app.use('/api/languages', languagesRouter);
  app.use('/stories', storiesRouter);
  app.use('/connectivity', connectivityRouter);

  app.use('/family', requireAuth, familyRouter);
  app.use('/api/wireless', wirelessRouter);

  // eSIM: mount conditionally via feature flag
  if (ESIM_ENABLED) {
    app.use('/esim', esimRouter); // includes POST /esim/webhooks/teal internally
  }

  if (String(process.env.FEATURE_PHYSICAL_SIM || '').toLowerCase() === 'true') {
    app.use('/sims', simsRouter);
  }

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

  // Dev-only mock endpoints
  if (process.env.NODE_ENV !== 'production') {
    app.use(smsDevRouter); // exposes POST /_dev/sms/inbound
  }

  // Enable mock only in dev-like contexts (choose the toggle you prefer)
  const USE_SMS_MOCK =
    String(process.env.SMS_PROVIDER || '').toLowerCase() === 'mock' ||
    (process.env.NODE_ENV !== 'production' && !process.env.TWILIO_ACCOUNT_SID);

  if (USE_SMS_MOCK) {
    // Mount first so it wins for POST /sms/send
    app.use('/sms', smsDevMock);
  }

  if (USE_SMS_MOCK) {
    app.use(smsDevInbound);
  }

  /* Errors (Sentry-safe first, then your handlers) */
  if (isProd) {
    app.use(sentryErrorHandler); // no-op if Sentry disabled/invalid DSN
  }
  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
