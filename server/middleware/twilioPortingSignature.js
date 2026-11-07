import express from 'express';
import twilio from 'twilio';

function publicOrigin() {
  const configured = process.env.TWILIO_PORTING_WEBHOOK_URL ||
    process.env.TWILIO_WEBHOOK_BASE_URL || process.env.APP_API_ORIGIN;
  if (!configured) return null;
  try {
    const url = new URL(configured);
    if (url.protocol !== 'https:' || url.username || url.password ||
        url.search || url.hash) return null;
    return url.origin;
  } catch {
    return null;
  }
}

function validatePortingSignature(req, res, next) {
  if (req.method !== 'POST') return next();
  const token = process.env.TWILIO_AUTH_TOKEN;
  const origin = publicOrigin();
  if (!token || !origin) return res.sendStatus(503);

  const signature = req.get('X-Twilio-Signature');
  if (!signature || !req.is('application/json') || !Buffer.isBuffer(req.body)) {
    return res.sendStatus(403);
  }

  // Validate against the configured public origin and the exact path/query.
  // The Host and forwarded protocol headers are caller-controlled here.
  const callbackUrl = origin + req.originalUrl;
  const rawBody = req.body.toString('utf8');
  try {
    if (!twilio.validateRequestWithBody(token, signature, callbackUrl, rawBody)) {
      return res.sendStatus(403);
    }
  } catch {
    return res.sendStatus(403);
  }
  try {
    const parsed = JSON.parse(rawBody);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return res.sendStatus(400);
    }
    req.body = parsed;
    return next();
  } catch {
    return res.sendStatus(400);
  }
}

export function installTwilioPortingGuard(app) {
  app.use(
    ['/webhooks/twilio/porting', '/api/webhooks/twilio/porting'],
    express.raw({ type: 'application/json', limit: '512kb' }),
    validatePortingSignature
  );
}
