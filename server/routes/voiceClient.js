import express from 'express';
import twilio from 'twilio';
import { requireAuth } from '../middleware/auth.js';

const router = express.Router();

const { jwt } = twilio;
const { AccessToken } = jwt;
const { VoiceGrant } = AccessToken;

/**
 * POST /voice/token
 *
 * Returns a Twilio Access Token that the browser can use with the
 * Twilio Voice JS SDK (Twilio.Device) to place/receive calls.
 *
 * Requires:
 *   TWILIO_ACCOUNT_SID
 *   TWILIO_API_KEY_SID
 *   TWILIO_API_KEY_SECRET
 *   TWILIO_VOICE_TWIML_APP_SID  (Twilio Voice App that points to /webhooks/voice/client)
 */
router.post('/token', requireAuth, (req, res) => {
  try {
    const accountSid = process.env.TWILIO_ACCOUNT_SID;
    const apiKeySid = process.env.TWILIO_API_KEY_SID;
    const apiKeySecret = process.env.TWILIO_API_KEY_SECRET;
    const appSid = process.env.TWILIO_VOICE_TWIML_APP_SID;

    if (!accountSid || !apiKeySid || !apiKeySecret || !appSid) {
      return res.status(500).json({
        error: 'Twilio Voice token not configured (missing env vars)',
      });
    }

    // Identity: tie to Chatforia user
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const identity = `user:${userId}`;

    // 1 hour TTL is usually fine
    const ttlSeconds = 60 * 60;

    const token = new AccessToken(accountSid, apiKeySid, apiKeySecret, {
      ttl: ttlSeconds,
    });
    token.identity = identity;

    const voiceGrant = new VoiceGrant({
      outgoingApplicationSid: appSid,
      incomingAllow: true, // allow inbound client calls later if you want
    });

    token.addGrant(voiceGrant);

    const jwtToken = token.toJwt();

    return res.json({
      token: jwtToken,
      identity,
      ttlSeconds,
    });
  } catch (err) {
    console.error('[voiceClient] token error', err);
    return res.status(500).json({ error: 'Failed to create voice token' });
  }
});

export default router;
