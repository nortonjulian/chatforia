import invariant from '../utils/invariant.js';
import { ENV } from './env.js';

/** soft-capable validator: warn in dev/test, throw in prod (or when soft=false) */
function requireNonEmpty(value, name, { advice, soft = false } = {}) {
  const ok = !!value && String(value).trim().length > 0;
  if (ok) return true;

  const msg = `[env] ${name} is required${advice ? `: ${advice}` : ''}`;
  if (soft) {
    // eslint-disable-next-line no-console
    console.warn(msg);
    return false;
  }
  invariant(false, msg);
}

/**
 * Validate critical configuration. Throw early if something is off (prod).
 * In dev/test we prefer WARN + continue so local DX isn't blocked.
 */
export default function validateEnv() {
  const { IS_PROD, IS_TEST } = ENV;
  const SOFT = !IS_PROD; // dev/test => warn instead of throw

  // ─────────────────────────────────────────────────────────────
  // Core required
  // ─────────────────────────────────────────────────────────────
  requireNonEmpty(ENV.DATABASE_URL, 'DATABASE_URL', { soft: SOFT });
  requireNonEmpty(ENV.JWT_SECRET, 'JWT_SECRET', {
    advice: 'use a long random string (>= 32 chars recommended)',
    soft: SOFT,
  });

  if (IS_PROD) {
    invariant(
      ENV.JWT_SECRET && ENV.JWT_SECRET.length >= 16,
      '[env] JWT_SECRET should be at least 16 chars in production'
    );
  }

  // ─────────────────────────────────────────────────────────────
  // HTTPS / cookies
  // ─────────────────────────────────────────────────────────────
  if (IS_PROD) {
    invariant(ENV.FORCE_HTTPS, '[env] FORCE_HTTPS must be true in production');
    // COOKIE_DOMAIN is optional but recommended in prod
    if (!ENV.COOKIE_DOMAIN) {
      // eslint-disable-next-line no-console
      console.warn('[env] Consider setting COOKIE_DOMAIN for cross-subdomain cookies');
    }
    invariant(ENV.COOKIE_SECURE, '[env] COOKIE_SECURE must be true in production');
  }

  // ─────────────────────────────────────────────────────────────
  // CORS: at least one allowed origin (frontend)
  // ─────────────────────────────────────────────────────────────
  const hasCorsList = Array.isArray(ENV.CORS_ORIGINS) && ENV.CORS_ORIGINS.length > 0;
  const hasFrontend = !!ENV.FRONTEND_ORIGIN;
  if (SOFT) {
    if (!hasCorsList && !hasFrontend && !IS_TEST) {
      // eslint-disable-next-line no-console
      console.warn('[env] CORS_ORIGINS or FRONTEND_ORIGIN should be set (comma-separated origins)');
    }
  } else {
    invariant(
      hasCorsList || hasFrontend || IS_TEST,
      '[env] CORS_ORIGINS or FRONTEND_ORIGIN should be set (comma-separated origins)'
    );
  }

  // ─────────────────────────────────────────────────────────────
  // Stripe: if one is set, require the other (optional overall)
  // ─────────────────────────────────────────────────────────────
  if (ENV.STRIPE_SECRET_KEY || ENV.STRIPE_WEBHOOK_SECRET) {
    requireNonEmpty(ENV.STRIPE_SECRET_KEY, 'STRIPE_SECRET_KEY', { soft: SOFT });
    requireNonEmpty(ENV.STRIPE_WEBHOOK_SECRET, 'STRIPE_WEBHOOK_SECRET', { soft: SOFT });
  }

  // ─────────────────────────────────────────────────────────────
  // eSIM / Connectivity (Teal) — only if explicitly enabled
  // ─────────────────────────────────────────────────────────────
  const esimEnabled = String(ENV.FEATURE_ESIM || '').toLowerCase() === 'true';
  if (esimEnabled) {
    requireNonEmpty(ENV.TEAL_API_KEY, 'TEAL_API_KEY', { soft: SOFT });
    requireNonEmpty(ENV.TEAL_BASE_URL, 'TEAL_BASE_URL', { soft: SOFT });
  }

  // ─────────────────────────────────────────────────────────────
  // Telco: only validate if provider selected AND not disabled
  // (Original Telnyx/Bandwidth block kept commented)
  // ─────────────────────────────────────────────────────────────
  // const telcoValidationDisabled =
  //   String(ENV.DISABLE_TELCO_VALIDATION || '').toLowerCase() === 'true';
  //
  // if (!telcoValidationDisabled) {
  //   if (ENV.TELCO_PROVIDER === 'telnyx') {
  //     requireNonEmpty(ENV.TELNYX_API_KEY, 'TELNYX_API_KEY', { soft: SOFT });
  //     const hasFrom =
  //       !!ENV.TELNYX_MESSAGING_PROFILE_ID || !!ENV.TELNYX_FROM_NUMBER;
  //     if (SOFT) {
  //       if (!hasFrom) {
  //         // eslint-disable-next-line no-console
  //         console.warn(
  //           '[env] TELNYX_MESSAGING_PROFILE_ID or TELNYX_FROM_NUMBER is required for Telnyx'
  //         );
  //       }
  //     } else {
  //       invariant(
  //         hasFrom,
  //         '[env] TELNYX_MESSAGING_PROFILE_ID or TELNYX_FROM_NUMBER is required for Telnyx'
  //       );
  //     }
  //   }
  //   if (ENV.TELCO_PROVIDER === 'bandwidth') {
  //     requireNonEmpty(ENV.BANDWIDTH_ACCOUNT_ID, 'BANDWIDTH_ACCOUNT_ID', { soft: SOFT });
  //     requireNonEmpty(ENV.BANDWIDTH_USER_ID, 'BANDWIDTH_USER_ID', { soft: SOFT });
  //     requireNonEmpty(ENV.BANDWIDTH_PASSWORD, 'BANDWIDTH_PASSWORD', { soft: SOFT });
  //     requireNonEmpty(ENV.BANDWIDTH_MESSAGING_APPLICATION_ID, 'BANDWIDTH_MESSAGING_APPLICATION_ID', { soft: SOFT });
  //     requireNonEmpty(ENV.BANDWIDTH_FROM_NUMBER, 'BANDWIDTH_FROM_NUMBER', { soft: SOFT });
  //   }
  // } else if (!IS_TEST) {
  //   // eslint-disable-next-line no-console
  //   console.warn('[env] Telco validation disabled via DISABLE_TELCO_VALIDATION=true');
  // }

  // ─────────────────────────────────────────────────────────────
  // Telco: Twilio (selected provider)
  // Only validate if Twilio is selected OR any Twilio vars are present.
  // You can disable with DISABLE_TELCO_VALIDATION=true
  // ─────────────────────────────────────────────────────────────
  const telcoValidationDisabled =
    String(ENV.DISABLE_TELCO_VALIDATION || '').toLowerCase() === 'true';

  if (!telcoValidationDisabled) {
    const wantsTwilio =
      (String(ENV.DEFAULT_PROVIDER || '').toLowerCase() === 'twilio') ||
      !!ENV.TWILIO_ACCOUNT_SID ||
      !!ENV.TWILIO_AUTH_TOKEN ||
      !!ENV.TWILIO_MESSAGING_SERVICE_SID ||
      !!ENV.TWILIO_FROM_NUMBER;

    if (wantsTwilio) {
      requireNonEmpty(ENV.TWILIO_ACCOUNT_SID, 'TWILIO_ACCOUNT_SID', { soft: SOFT });
      requireNonEmpty(ENV.TWILIO_AUTH_TOKEN, 'TWILIO_AUTH_TOKEN', { soft: SOFT });

      // Needed to mint Access Tokens for Video/Voice/WebRTC, etc.
      requireNonEmpty(ENV.TWILIO_API_KEY_SID, 'TWILIO_API_KEY_SID', { soft: SOFT });
      requireNonEmpty(ENV.TWILIO_API_KEY_SECRET, 'TWILIO_API_KEY_SECRET', { soft: SOFT });

      const hasMessagingId = !!ENV.TWILIO_MESSAGING_SERVICE_SID || !!ENV.TWILIO_FROM_NUMBER;
      if (SOFT) {
        if (!hasMessagingId) {
          // eslint-disable-next-line no-console
          console.warn(
            '[env] TWILIO_MESSAGING_SERVICE_SID or TWILIO_FROM_NUMBER is required for Twilio messaging'
          );
        }
      } else {
        invariant(
          hasMessagingId,
          '[env] TWILIO_MESSAGING_SERVICE_SID or TWILIO_FROM_NUMBER is required for Twilio messaging'
        );
      }

      // Optional: voice settings sanity check (warn-only).
      if (!IS_TEST && !ENV.TWILIO_VOICE_TWIML_APP_SID && !ENV.TWILIO_VOICE_WEBHOOK_URL) {
        // eslint-disable-next-line no-console
        console.warn(
          '[env] Twilio voice not configured (set TWILIO_VOICE_TWIML_APP_SID or TWILIO_VOICE_WEBHOOK_URL) — OK if you are not using voice yet'
        );
      }
    }
  } else if (!IS_TEST) {
    // eslint-disable-next-line no-console
    console.warn('[env] Telco validation disabled via DISABLE_TELCO_VALIDATION=true');
  }

  // (Legacy Telnyx/Bandwidth validation kept for future re-enable)
  // if (ENV.TELCO_PROVIDER === 'telnyx') { ... }
  // if (ENV.TELCO_PROVIDER === 'bandwidth') { ... }

  // ─────────────────────────────────────────────────────────────
  // Optional STUN/TURN guard (warn-only)
  // ─────────────────────────────────────────────────────────────
  if (!IS_TEST && ENV.TWILIO_TURN_USER && !ENV.TWILIO_TURN_PASS) {
    // eslint-disable-next-line no-console
    console.warn(
      '[env] TWILIO_TURN_USER is set without TWILIO_TURN_PASS; consider using Twilio Network Traversal tokens instead of static TURN creds.'
    );
  }

  // ─────────────────────────────────────────────────────────────
  // Upload target
  // ─────────────────────────────────────────────────────────────
  const allowedTargets = ['memory', 'local', 'disk'];
  if (SOFT) {
    if (!allowedTargets.includes(ENV.UPLOAD_TARGET)) {
      // eslint-disable-next-line no-console
      console.warn(
        `[env] UPLOAD_TARGET should be one of ${allowedTargets.join('|')} (got "${ENV.UPLOAD_TARGET}"). Defaulting to "memory" may be unsafe in prod.`
      );
    }
  } else {
    invariant(
      allowedTargets.includes(ENV.UPLOAD_TARGET),
      `[env] UPLOAD_TARGET must be one of ${allowedTargets.join('|')} (got "${ENV.UPLOAD_TARGET}")`
    );
  }

  // Optional heads-up if you're on memory in dev
  if (SOFT && ENV.UPLOAD_TARGET === 'memory') {
    // eslint-disable-next-line no-console
    console.warn('[uploads] Using memory storage — fine for dev/test, not for production');
  }

  // ─────────────────────────────────────────────────────────────
  // Sentry (optional): warn in prod if missing
  // ─────────────────────────────────────────────────────────────
  if (IS_PROD && !ENV.SENTRY_DSN) {
    // eslint-disable-next-line no-console
    console.warn('[env] SENTRY_DSN not set — error visibility will be reduced in production');
  }

  // Test-specific relaxations currently handled by SOFT flag
}
