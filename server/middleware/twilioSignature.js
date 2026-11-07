import express from 'express';
import twilio from 'twilio';

function publicOrigin(kind) {
  const configured = kind === 'voice'
    ? process.env.TWILIO_VOICE_WEBHOOK_URL ||
      process.env.TWILIO_WEBHOOK_BASE_URL ||
      process.env.APP_API_ORIGIN
    : process.env.TWILIO_WEBHOOK_BASE_URL || process.env.APP_API_ORIGIN;

  if (!configured) return null;

  try {
    const url = new URL(configured);
    if (
      url.protocol !== 'https:' ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    ) return null;
    return url.origin;
  } catch {
    return null;
  }
}

function requireTwilioSignature(kind) {
  return (req, res, next) => {
    if (req.method !== 'POST') return next();

    const token = process.env.TWILIO_AUTH_TOKEN;
    const origin = publicOrigin(kind);
    if (!token || !origin) return res.sendStatus(503);

    const body = req.body;
    if (
      !req.get('X-Twilio-Signature') ||
      !req.is('application/x-www-form-urlencoded') ||
      !body ||
      typeof body !== 'object' ||
      Array.isArray(body) ||
      Object.values(body).some((value) =>
        typeof value !== 'string' &&
        !(Array.isArray(value) && value.every((item) => typeof item === 'string'))
      )
    ) return res.sendStatus(403);

    // Use the configured public origin and the original path/query. Forwarded
    // Host/Proto headers can be supplied by a caller and must not select the URL.
    const callbackUrl = origin + req.originalUrl;
    try {
      if (twilio.validateRequest(
        token,
        req.get('X-Twilio-Signature'),
        callbackUrl,
        body
      )) return next();
    } catch {
      // Malformed parameters are denied without exposing the request or token.
    }
    return res.sendStatus(403);
  };
}

export function installTwilioCallbackGuards(app) {
  const parseForm = express.urlencoded({ extended: false, limit: '512kb' });
  app.use(
    ['/webhooks/voice', '/api/webhooks/voice'],
    parseForm,
    requireTwilioSignature('voice')
  );
  app.use(
    ['/webhooks/sms/twilio', '/api/webhooks/sms/twilio', '/webhooks/status'],
    parseForm,
    requireTwilioSignature('sms')
  );
}
