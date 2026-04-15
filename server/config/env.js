const bool = (v, dflt = false) => {
  if (v == null) return dflt;
  const s = String(v).toLowerCase().trim();
  return ['1', 'true', 'yes', 'on'].includes(s);
};

const num = (v, dflt) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : dflt;
};

/**
 * Canonical normalized env for the app.
 * Keep this as the single source of truth for env access.
 */
export const ENV = {
  NODE_ENV: process.env.NODE_ENV || 'development',
  IS_PROD: (process.env.NODE_ENV || '').toLowerCase() === 'production',
  IS_TEST: (process.env.NODE_ENV || '').toLowerCase() === 'test',

  // Core
  PORT: num(process.env.PORT, 5002),
  DATABASE_URL: process.env.DATABASE_URL || '',
  JWT_SECRET: process.env.JWT_SECRET || '',
  SESSION_SECRET: process.env.SESSION_SECRET || '',
  COOKIE_DOMAIN: process.env.COOKIE_DOMAIN || '',
  COOKIE_SECURE: bool(process.env.COOKIE_SECURE, false),
  FORCE_HTTPS: bool(process.env.FORCE_HTTPS, true),

  // Origins / CORS
  FRONTEND_ORIGIN: process.env.FRONTEND_ORIGIN || '',
  FRONTEND_URL: process.env.FRONTEND_URL || '',
  FRONTEND_BASE_URL: process.env.FRONTEND_BASE_URL || '',
  APP_ORIGIN: process.env.APP_ORIGIN || '',
  APP_URL: process.env.APP_URL || '',
  PUBLIC_BASE_URL: process.env.PUBLIC_BASE_URL || '',
  CORS_ORIGINS: (process.env.CORS_ORIGINS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),

  // Observability
  SENTRY_DSN: process.env.SENTRY_DSN || '',
  SENTRY_TRACES_RATE: process.env.SENTRY_TRACES_RATE || '',

  // OpenAI / AI
  OPENAI_API_KEY: process.env.OPENAI_API_KEY || '',
  OPENAI_MODEL: process.env.OPENAI_MODEL || 'gpt-4o-mini',
  FEATURE_AI: bool(process.env.FEATURE_AI, false),
  ENABLE_SMART_REPLIES: bool(process.env.ENABLE_SMART_REPLIES, false),
  ENABLE_AI_RESPONDER: bool(process.env.ENABLE_AI_RESPONDER, false),

  // Email / Resend
  RESEND_API_KEY: process.env.RESEND_API_KEY || '',
  FEATURE_EMAIL: bool(process.env.FEATURE_EMAIL, false),
  EMAIL_FROM: process.env.EMAIL_FROM || 'Chatforia <hello@chatforia.com>',

  // Billing / Paddle
  BILLING_PROVIDER: (process.env.BILLING_PROVIDER || '').toLowerCase(),
  PADDLE_API_KEY: process.env.PADDLE_API_KEY || '',
  PADDLE_WEBHOOK_SECRET: process.env.PADDLE_WEBHOOK_SECRET || '',

  // Twilio / telephony
  DISABLE_TELCO_VALIDATION: bool(process.env.DISABLE_TELCO_VALIDATION, false),
  DEFAULT_PROVIDER: (process.env.DEFAULT_PROVIDER || 'twilio').toLowerCase(),

  TWILIO_ACCOUNT_SID: process.env.TWILIO_ACCOUNT_SID || '',
  TWILIO_AUTH_TOKEN: process.env.TWILIO_AUTH_TOKEN || '',
  TWILIO_API_KEY_SID: process.env.TWILIO_API_KEY_SID || '',
  TWILIO_API_KEY_SECRET: process.env.TWILIO_API_KEY_SECRET || '',
  TWILIO_MESSAGING_SERVICE_SID: process.env.TWILIO_MESSAGING_SERVICE_SID || '',
  TWILIO_FROM_NUMBER: process.env.TWILIO_FROM_NUMBER || '',
  TWILIO_VOICE_TWIML_APP_SID: process.env.TWILIO_VOICE_TWIML_APP_SID || '',
  TWILIO_VOICE_WEBHOOK_URL: process.env.TWILIO_VOICE_WEBHOOK_URL || '',
  TWILIO_VOICE_STATUS_CALLBACK_URL:
    process.env.TWILIO_VOICE_STATUS_CALLBACK_URL || '',
  TWILIO_STUN:
    process.env.TWILIO_STUN || 'stun:global.stun.twilio.com:3478',
  TWILIO_TURN_URL: process.env.TWILIO_TURN_URL || '',
  TWILIO_TURN_USER: process.env.TWILIO_TURN_USER || '',
  TWILIO_TURN_PASS: process.env.TWILIO_TURN_PASS || '',

  // Mailer fallback
  SMTP_HOST: process.env.SMTP_HOST || '',
  SMTP_PORT: num(process.env.SMTP_PORT, 587),
  SMTP_SECURE: bool(process.env.SMTP_SECURE, false),
  SMTP_USER: process.env.SMTP_USER || '',
  SMTP_PASS: process.env.SMTP_PASS || '',

  // Number lifecycle
  NUMBER_INACTIVITY_DAYS: num(process.env.NUMBER_INACTIVITY_DAYS, 30),
  NUMBER_HOLD_DAYS: num(process.env.NUMBER_HOLD_DAYS, 14),
  RESERVATION_MINUTES: num(process.env.RESERVATION_MINUTES, 10),

  // Media / R2
  FEATURE_MEDIA_UPLOADS: bool(process.env.FEATURE_MEDIA_UPLOADS, false),
  FEATURE_R2: bool(process.env.FEATURE_R2, false),
  UPLOAD_TARGET: (process.env.UPLOAD_TARGET || 'memory').toLowerCase(),
  R2_ACCESS_KEY_ID: process.env.R2_ACCESS_KEY_ID || '',
  R2_SECRET_ACCESS_KEY: process.env.R2_SECRET_ACCESS_KEY || '',
  R2_S3_ENDPOINT: process.env.R2_S3_ENDPOINT || '',
  R2_BUCKET: process.env.R2_BUCKET || '',
  R2_PUBLIC_BASE: process.env.R2_PUBLIC_BASE || '',

  // Feature flags
  STATUS_ENABLED: bool(process.env.STATUS_ENABLED, false),
  FEATURE_ESIM: bool(process.env.FEATURE_ESIM, false),
  FEATURE_PHYSICAL_SIM: bool(process.env.FEATURE_PHYSICAL_SIM, false),

  // eSIM / connectivity
  ESIM_PROVIDER: (process.env.ESIM_PROVIDER || 'telna').toLowerCase(),
};

export const cfg = {
  twilioAccountSid: ENV.TWILIO_ACCOUNT_SID,
  twilioAuthToken: ENV.TWILIO_AUTH_TOKEN,
  twilioMessagingServiceSid: ENV.TWILIO_MESSAGING_SERVICE_SID,
  twilioFromNumber: ENV.TWILIO_FROM_NUMBER,
  twilioVoiceTwiMLAppSid: ENV.TWILIO_VOICE_TWIML_APP_SID,
  twilioVoiceWebhookUrl: ENV.TWILIO_VOICE_WEBHOOK_URL,
  twilioVoiceStatusCallbackUrl: ENV.TWILIO_VOICE_STATUS_CALLBACK_URL,
  twilioStun: ENV.TWILIO_STUN,
  twilioTurnUrl: ENV.TWILIO_TURN_URL,
  twilioTurnUser: ENV.TWILIO_TURN_USER,
  twilioTurnPass: ENV.TWILIO_TURN_PASS,

  inactivityDays: ENV.NUMBER_INACTIVITY_DAYS,
  holdDays: ENV.NUMBER_HOLD_DAYS,
  reserveMinutes: ENV.RESERVATION_MINUTES,
  defaultProvider: ENV.DEFAULT_PROVIDER,
};

export function assertProviderEnv() {
  const missing = [];

  if (!ENV.TWILIO_ACCOUNT_SID) missing.push('TWILIO_ACCOUNT_SID');
  if (!ENV.TWILIO_AUTH_TOKEN) missing.push('TWILIO_AUTH_TOKEN');

  if (!ENV.TWILIO_MESSAGING_SERVICE_SID && !ENV.TWILIO_FROM_NUMBER) {
    missing.push('TWILIO_MESSAGING_SERVICE_SID or TWILIO_FROM_NUMBER');
  }

  if (missing.length) {
    console.warn(
      '[WARN] Missing Twilio env:',
      missing.join(', '),
      '— Twilio messaging/voice features will be limited until set.'
    );
  }
}