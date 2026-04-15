import invariant from '../utils/invariant.js';
import { ENV } from './env.js';

function has(value) {
  return Boolean(String(value || '').trim());
}

function requireNonEmpty(value, name, { soft = false, advice } = {}) {
  if (has(value)) return true;

  const msg = `[env] ${name} is required${advice ? ` — ${advice}` : ''}`;

  if (soft) {
    console.warn(msg);
    return false;
  }

  invariant(false, msg);
}

function warnIfMissing(value, name, advice) {
  if (!has(value)) {
    console.warn(`[env] ${name} is missing${advice ? ` — ${advice}` : ''}`);
    return false;
  }
  return true;
}

export default function validateEnv() {
  const IS_PROD = ENV.IS_PROD;
  const SOFT = !IS_PROD;

  // -----------------------------
  // Core: required for API boot
  // -----------------------------
  requireNonEmpty(ENV.DATABASE_URL, 'DATABASE_URL', { soft: false });
  requireNonEmpty(ENV.JWT_SECRET, 'JWT_SECRET', {
    soft: false,
    advice: 'set a strong secret for auth/token signing',
  });

  if (IS_PROD) {
    requireNonEmpty(
      ENV.FRONTEND_ORIGIN || ENV.FRONTEND_URL || ENV.FRONTEND_BASE_URL || ENV.APP_ORIGIN,
      'FRONTEND_ORIGIN',
      {
        soft: false,
        advice: 'required for production redirects/cookies/CORS',
      }
    );
  }

  // -----------------------------
  // Feature intent detection
  // -----------------------------
  const telcoValidationDisabled = ENV.DISABLE_TELCO_VALIDATION;

  const wantsTwilio =
    !telcoValidationDisabled &&
    (
      String(ENV.DEFAULT_PROVIDER || '').toLowerCase() === 'twilio' ||
      has(ENV.TWILIO_ACCOUNT_SID) ||
      has(ENV.TWILIO_AUTH_TOKEN) ||
      has(ENV.TWILIO_API_KEY_SID) ||
      has(ENV.TWILIO_API_KEY_SECRET) ||
      has(ENV.TWILIO_MESSAGING_SERVICE_SID) ||
      has(ENV.TWILIO_FROM_NUMBER) ||
      has(ENV.TWILIO_VOICE_TWIML_APP_SID) ||
      has(ENV.TWILIO_VOICE_WEBHOOK_URL)
    );

  const wantsOpenAI =
    has(ENV.OPENAI_API_KEY) ||
    ENV.FEATURE_AI ||
    ENV.ENABLE_SMART_REPLIES ||
    ENV.ENABLE_AI_RESPONDER;

  const wantsResend =
    has(ENV.RESEND_API_KEY) ||
    ENV.FEATURE_EMAIL;

  const wantsPaddle =
    has(ENV.PADDLE_API_KEY) ||
    has(ENV.PADDLE_WEBHOOK_SECRET) ||
    String(ENV.BILLING_PROVIDER || '').toLowerCase() === 'paddle';

  const wantsR2 =
    ENV.FEATURE_MEDIA_UPLOADS ||
    ENV.FEATURE_R2 ||
    has(ENV.R2_BUCKET) ||
    has(ENV.R2_ACCESS_KEY_ID) ||
    has(ENV.R2_SECRET_ACCESS_KEY) ||
    has(ENV.R2_S3_ENDPOINT);

  // -----------------------------
  // Twilio / telephony
  // -----------------------------
  if (wantsTwilio) {
    requireNonEmpty(ENV.TWILIO_ACCOUNT_SID, 'TWILIO_ACCOUNT_SID', { soft: SOFT });
    requireNonEmpty(ENV.TWILIO_AUTH_TOKEN, 'TWILIO_AUTH_TOKEN', { soft: SOFT });

    const wantsClientSdk =
      has(ENV.TWILIO_API_KEY_SID) ||
      has(ENV.TWILIO_API_KEY_SECRET) ||
      has(ENV.TWILIO_VOICE_TWIML_APP_SID) ||
      has(ENV.TWILIO_VOICE_WEBHOOK_URL);

    if (wantsClientSdk) {
      requireNonEmpty(ENV.TWILIO_API_KEY_SID, 'TWILIO_API_KEY_SID', { soft: SOFT });
      requireNonEmpty(ENV.TWILIO_API_KEY_SECRET, 'TWILIO_API_KEY_SECRET', { soft: SOFT });
    }

    const hasMessagingIdentity =
      has(ENV.TWILIO_MESSAGING_SERVICE_SID) || has(ENV.TWILIO_FROM_NUMBER);

    if (!hasMessagingIdentity) {
      console.warn(
        '[env] Twilio configured without messaging identity; SMS features may fail'
      );
    }
  } else {
    console.warn('[env] Twilio validation skipped');
  }

  // -----------------------------
  // OpenAI
  // -----------------------------
  if (wantsOpenAI) {
    requireNonEmpty(ENV.OPENAI_API_KEY, 'OPENAI_API_KEY', { soft: SOFT });
  } else {
    console.warn('[env] OpenAI validation skipped');
  }

  // -----------------------------
  // Email / Resend
  // -----------------------------
  if (wantsResend) {
    requireNonEmpty(ENV.RESEND_API_KEY, 'RESEND_API_KEY', { soft: SOFT });
  } else {
    console.warn('[env] Email provider validation skipped');
  }

  // -----------------------------
  // Paddle
  // -----------------------------
  if (wantsPaddle) {
    requireNonEmpty(ENV.PADDLE_API_KEY, 'PADDLE_API_KEY', { soft: SOFT });
    requireNonEmpty(ENV.PADDLE_WEBHOOK_SECRET, 'PADDLE_WEBHOOK_SECRET', { soft: SOFT });
  }

  // -----------------------------
  // R2 / media storage
  // -----------------------------
  if (wantsR2) {
    warnIfMissing(ENV.R2_ACCESS_KEY_ID, 'R2_ACCESS_KEY_ID');
    warnIfMissing(ENV.R2_SECRET_ACCESS_KEY, 'R2_SECRET_ACCESS_KEY');
    warnIfMissing(ENV.R2_S3_ENDPOINT, 'R2_S3_ENDPOINT');
    warnIfMissing(ENV.R2_BUCKET, 'R2_BUCKET');
    warnIfMissing(
      ENV.R2_PUBLIC_BASE,
      'R2_PUBLIC_BASE',
      'returned URLs may not be CDN-backed'
    );
  }

  // -----------------------------
  // Observability
  // -----------------------------
  if (IS_PROD && !has(ENV.SENTRY_DSN)) {
    console.warn(
      '[env] SENTRY_DSN not set — error visibility will be reduced in production'
    );
  }
}