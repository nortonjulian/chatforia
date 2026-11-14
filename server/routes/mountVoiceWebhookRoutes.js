/**
 * The older broad webhook router also defines POST /voice/inbound.
 * App Voice must be mounted first so assigned numbers ring registered
 * Twilio Voice clients, including when they are abroad on internet data.
 */
export function mountVoiceWebhookRoutes(app, { voiceWebhooks, legacyWebhooks }) {
  app.use('/webhooks/voice', voiceWebhooks);
  app.use('/api/webhooks/voice', voiceWebhooks);
  app.use('/webhooks', legacyWebhooks);
}
