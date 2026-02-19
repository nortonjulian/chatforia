import 'dotenv/config';

import express from 'express';
import compression from 'compression';
import cookieParser from 'cookie-parser';
import rateLimit from 'express-rate-limit';

// import listEndpoints from 'express-list-endpoints';
import path from 'path';
import { fileURLToPath } from 'url';

import authMiddleware from './middleware/auth.js';

import voiceClientRouter from './routes/voiceClient.js';

import prisma from './utils/prismaClient.js'; // add near the top of app.js with other imports

// SAFE Sentry wrappers (no-op when DSN is missing/invalid)
import { sentryRequestHandler, sentryErrorHandler } from './middleware/audit.js';

import adminVoiceLogsRouter from './routes/adminVoiceLogs.js';

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
import billingRouter from './routes/billing.js';
// import billingWebhook from './routes/billingWebhook.js';    // ❌ removed (now unified)
import contactsImportRouter from './routes/contactsImport.js';
import uploadsRouter from './routes/uploads.js';
import smsRouter from './routes/sms.js';
import searchPeopleRouter from './routes/search.people.js';
import voiceRouter from './routes/voice.js';
import voiceCallsRouter from './routes/voiceCalls.js';
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

import conversationsRouter from './routes/conversations.js';

import webhooksTwilio from './routes/webhooksTwilio.js';

import familyRouter from './routes/family.js';
import wirelessRouter from './routes/wireless.js';

import voicemailRouter from './routes/voicemail.js';
import voicemailGreetingRouter from './routes/voicemailGreeting.js';

import portingRouter from './routes/porting.js';
import twilioPortingWebhook from './routes/twilioPortingWebhook.js';

// 🔒 auth gates
import { requireAuth, verifyTokenOptional } from './middleware/auth.js';
// ✅ enforcement gates
import {
  requireEmailVerified,
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

import twilioStatusWebhook from './webhooks/status.js';

import phoneRoutes from './routes/api/phone.js';

// eSIM feature flag
import { ESIM_ENABLED } from './config/esim.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

console.log('[env-debug] STRIPE_SECRET_KEY present =', !!process.env.STRIPE_SECRET_KEY);

function csrfOnlyForCookieAuth(csrfMw) {
  return (req, res, next) => {
    const auth = req.headers.authorization;
    const hasBearer = typeof auth === 'string' && auth.startsWith('Bearer ');
    if (hasBearer) return next();           // ✅ iOS / API clients
    return csrfMw(req, res, next);          // ✅ browser cookie/session
  };
}

export function createApp() {
  const app = express();

  const isProd = process.env.NODE_ENV === 'production';
  const isTest = process.env.NODE_ENV === 'test';

  // For your current setup (frontend :5173, API :5002) we want
  // cookies to be cross-site so the session is sent with XHR.
  const useCrossSiteCookies = true;

  if (process.env.NODE_ENV === 'production') {
    app.set('trust proxy', 1);
  } else {
    app.set('trust proxy', false);
  }

  console.log('[boot] createApp reached', { cwd: process.cwd() });

  /* Early security */
  app.use(httpsRedirect());

  // 🔧 CORS: dev vs prod
  const frontendOrigin = isProd ? process.env.FRONTEND_ORIGIN : 'http://localhost:5173';

  if (isProd && !frontendOrigin) {
    logger.warn('CORS: FRONTEND_ORIGIN is not set in production; cross-site requests may fail.');
  }

  app.use(
    cors({
      origin: frontendOrigin,
      credentials: true,
    })
  );

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

  // 🌍 Geo country (from CDN/proxy header, e.g. Cloudflare)
  // Adjust the header name if your provider uses something else.
  app.use((req, _res, next) => {
    const cfCountry = req.headers['cf-ipcountry']; // e.g. "US", "FR"
    if (cfCountry && cfCountry !== 'XX') {
      req.geoCountry = String(cfCountry).toUpperCase();
    }
    next();
  });

  // Attach Sentry request handler early (no-op if Sentry is disabled)
  if (isProd) {
    app.use(sentryRequestHandler);
  }

  // Auto XHR header in tests/dev fallbacks
  const AUTO_XHR = isTest || String(process.env.DEV_FALLBACKS || '').toLowerCase() === 'true';
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
        paths: ['req.headers.authorization', 'req.headers.cookie', 'res.headers["set-cookie"]'],
      },
    })
  );

  /* ---------- Session + Passport (must be before OAuth routes) ---------- */

  // In prod, share cookies across subdomains via COOKIE_DOMAIN (e.g. ".chatforia.com")
  const cookieDomain = isProd ? process.env.COOKIE_DOMAIN : undefined;
  if (isProd && !cookieDomain) {
    logger.warn(
      'SESSION: COOKIE_DOMAIN is not set in production; cookies will be scoped to the API host only.'
    );
  }

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
        ...(cookieDomain ? { domain: cookieDomain } : {}),
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

  // ✅ Never CSRF-block preflight
  app.use((req, _res, next) => {
    if (req.method === 'OPTIONS') return next();
    next();
  });


    /* CSRF */
  const csrfMw =
    isTest
      ? (_req, _res, next) => next()
      : buildCsrf({ isProd, cookieDomain: process.env.COOKIE_DOMAIN });

  // ✅ UPDATED: include ^\/_debug(\/|$)
  const csrfBypassPattern =
    /^\/auth\/(login|register|logout|apple\/callback)$|^\/billing\/webhook$|^\/billing\/portal$|^\/voice\/(inbound|voicemail|voicemail\/save)$|^\/webhooks(\/|$)|^\/_debug(\/|$)/;

  const csrfBrowserOnly = csrfOnlyForCookieAuth(csrfMw);

  // ✅ Never CSRF-block preflight
  app.use((req, _res, next) => {
    if (req.method === 'OPTIONS') return next();
    next();
  });

  app.use((req, res, next) => {
    const p = req.path;

    if (csrfBypassPattern.test(p)) {
      console.log('⚠️ CSRF bypass for:', p);
      return next();
    }

    return csrfBrowserOnly(req, res, next);
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

  // NOTE: ensure you've run `cd client && npm run build` so client/dist exists
  const distPath = path.resolve(__dirname, '../client/dist');

  // Serve static assets from the built client
  app.use(express.static(distPath));

  // Serve the consent page as a real HTML file (not the SPA shell)
  app.get(['/sms-consent', '/sms-consent/'], (req, res) => {
    return res.sendFile(path.join(distPath, 'sms-consent', 'index.html'));
  });

  /* Base routes */
  app.get('/', (_req, res) => res.send('Welcome to Chatforia API!'));

  /* -------------------------------------------
   * Billing: unified router
   * -------------------------------------------*/
  app.use('/billing', verifyTokenOptional, billingRouter);

  // OAuth under /auth
  app.use('/auth', oauthRouter);

  // Auth sub-routers before primary auth
  app.use('/auth', emailVerification); // /auth/email/*
  app.use('/auth/phone', requireAuth, phoneVerification); // /auth/phone/*
  app.use('/auth/2fa', requireAuth, mfaTotp); // /auth/2fa/*

  // Primary auth API
  app.use('/auth', authRouter);

  app.use('/users', usersRouter);

  // Inbound SMS webhooks (ungated)
  app.use('/webhooks/sms', smsWebhooks);
  app.use('/webhooks', webhooksTwilio);
  app.use('/webhooks/status', twilioStatusWebhook);

  app.use('/conversations', conversationsRouter);

  // PSTN/telephony surfaces (require at least email verification)
  app.use('/voice', voiceRouter);

  app.use('/voice/client', requireAuth, requireEmailVerified, voiceClientRouter);

  app.use('/calls', requireAuth, requireEmailVerified, callsRouter);
  app.use('/sms', smsRouter)
  app.use('/search/people', requireAuth, searchPeopleRouter);
  app.use('/webhooks/voice', voiceWebhooks);
  app.use('/api', videoTokens);
  app.use('/pricing', pricingRouter);
  app.use('/api/pricing', pricingRouter);

  app.use('/api/voicemail', voicemailRouter);
  app.use('/api/voicemail/greeting', voicemailGreetingRouter);

  app.use('/api/porting', authMiddleware, portingRouter);
  app.use('/webhooks/twilio/porting', express.json(), twilioPortingWebhook);

  app.use('/support', supportRouter);
  app.use('/ads', adsRouter);

  // 🔢 Numbers API: gate entire router by auth + email verification; lock is Premium
  app.post('/numbers/lock', requireAuth, requireEmailVerified, requirePremium, (req, _res, next) => next());
  app.use('/numbers', requireAuth, requireEmailVerified, numbersRouter);

  app.use('/rooms', roomsRouter);
  app.use('/chatrooms', roomsRouter);
  app.use('/messages', messagesRouter);

  app.use('/calls', voiceCallsRouter);

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
    app.use('/esim', esimRouter); // includes POST /esim/webhooks/
  }

  if (String(process.env.FEATURE_PHYSICAL_SIM || '').toLowerCase() === 'true') {
    app.use('/sims', simsRouter);
  }

  // Contacts bulk import (under /api to match Vite proxy)
  app.use('/api', contactsImportRouter);

  app.use('/api/phone', phoneRoutes);

  app.use('/calendar', calendarRouter);
  app.use('/', shareEventRouter);
  app.use('/', eventLinksRouter);

  app.use('/admin/voice-logs', adminVoiceLogsRouter);

  /* Status flag */
  const STATUS_ENABLED_FLAG = String(process.env.STATUS_ENABLED || '').toLowerCase() === 'true';
  const STATUS_ENABLED = isTest ? true : STATUS_ENABLED_FLAG;
  logger.info({ service: 'chatforia-server', env: process.env.NODE_ENV, STATUS_ENABLED }, 'Status routes feature flag');
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

  console.log('[sms-boot]', {
    NODE_ENV: process.env.NODE_ENV,
    SMS_PROVIDER: process.env.SMS_PROVIDER,
    hasTWILIO_ACCOUNT_SID: !!process.env.TWILIO_ACCOUNT_SID,
    USE_SMS_MOCK,
  });

  if (USE_SMS_MOCK) {
    // Mount first so it wins for POST /sms/send
    app.use('/sms', smsDevMock);
  }

  if (USE_SMS_MOCK) {
    app.use(smsDevInbound);
  }

  // ✅ NEW: DEV-only debug endpoint (ungated; CSRF bypassed by ^\/_debug)
  // NOTE: Place this BEFORE notFoundHandler/errorHandler.
  if (process.env.NODE_ENV !== 'production') {
    app.post('/_debug/sms/send', express.json(), async (req, res) => {
      try {
        const { sendSms } = await import('./lib/telco/index.js');
        const to = String(req.body?.to || '').trim();

        if (!to) return res.status(400).json({ ok: false, error: 'to is required' });

        const out = await sendSms({
          to,
          text: 'debug test',
          from: process.env.TWILIO_FROM_NUMBER, // force DID path
        });

        return res.json({ ok: true, out });
      } catch (e) {
        return res.status(500).json({ ok: false, error: e?.message || String(e) });
      }
    });
  }

  app.get('/__whoami', async (req, res) => {
  const r = await prisma.$queryRaw`SELECT current_database() as db, current_schema() as schema`;
  const dbInfo = Array.isArray(r) ? (r[0] ?? null) : null;
  const totalMessages = await prisma.message.count().catch(() => null);

  res.json({
  ok: true,
  env: process.env.NODE_ENV,
  host: req.get('host'),
  user: req.user ? { id: req.user.id, email: req.user.email } : null,
  dbInfo,
  totalMessages,
 });
});

  app.get('/__routes', (req, res) => {
    res.json({
      ok: true,
      host: req.headers.host,
      origin: req.headers.origin ?? null,
      hasCookie: !!req.headers.cookie,
      hasAuth: !!req.headers.authorization,
    });
});

  // ✅ CSRF error tap (AFTER all routes, BEFORE Sentry + your error handlers)
  app.use((err, req, res, next) => {
    if (err && err.code === 'EBADCSRFTOKEN') {
      console.log('❌ CSRF BLOCK', {
        path: req.path,
        method: req.method,
        hasAuth: !!req.headers.authorization,
        authHeader: req.headers.authorization || null,
        hasCookie: !!req.headers.cookie,
        origin: req.headers.origin,
        referer: req.headers.referer,
      });

      return res.status(403).json({
        ok: false,
        reason: 'csrf',
        path: req.path,
      });
    }

    return next(err);
  });

  /* Errors (Sentry-safe first, then your handlers) */
  if (isProd) {
    app.use(sentryErrorHandler); // no-op if Sentry disabled/invalid DSN
  }

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}

