import express from 'express';
import twilio from 'twilio';
import { requireAuth } from '../middleware/auth.js';

const router = express.Router();

const { jwt } = twilio;
const { AccessToken } = jwt;
const { VoiceGrant } = AccessToken;

/**
 * POST /voice/client/token
 *
 * Returns a Twilio Voice Access Token for Chatforia clients.
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

    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const identity = `user_${userId}`;
    const ttlSeconds = 60 * 60;

    const token = new AccessToken(accountSid, apiKeySid, apiKeySecret, {
      identity,
      ttl: ttlSeconds,
    });

    const androidPushCredentialSid =
      process.env.TWILIO_ANDROID_PUSH_CREDENTIAL_SID;

    const iosPushCredentialSid =
      process.env.TWILIO_IOS_PUSH_CREDENTIAL_SID;

    const platform = String(
      req.body?.platform ||
        req.query?.platform ||
        req.get('x-chatforia-platform') ||
        req.get('user-agent') ||
        ''
    ).toLowerCase();

    const isAndroid = platform.includes('android');

    const isIOS =
      platform.includes('ios') ||
      platform.includes('iphone') ||
      platform.includes('ipad') ||
      platform.includes('cfnetwork') ||
      platform.includes('darwin');

    const voiceGrantOptions = {
      outgoingApplicationSid: appSid,
      incomingAllow: true,
    };

    if (isAndroid && androidPushCredentialSid) {
      voiceGrantOptions.pushCredentialSid = androidPushCredentialSid;
    } else if (isIOS && iosPushCredentialSid) {
      voiceGrantOptions.pushCredentialSid = iosPushCredentialSid;
    }

    console.log('[voiceClient] token platform', {
      userId,
      identity,
      platform,
      isAndroid,
      isIOS,
      hasAndroidPushCredentialSid: Boolean(androidPushCredentialSid),
      hasIosPushCredentialSid: Boolean(iosPushCredentialSid),
      selectedPushCredentialSid: voiceGrantOptions.pushCredentialSid || null,
    });

    const voiceGrant = new VoiceGrant(voiceGrantOptions);
    token.addGrant(voiceGrant);

    return res.json({
      token: token.toJwt(),
      identity,
      ttlSeconds,
    });
  } catch (err) {
    console.error('[voiceClient] token error', err);
    return res.status(500).json({
      error: 'Failed to create voice token',
    });
  }
});

export default router;