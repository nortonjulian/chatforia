import express from 'express';
import { requireAuth } from '../middleware/auth.js';
import twilio from 'twilio';

const router = express.Router();

router.post('/video/token', requireAuth, async (req, res) => {
  try {
    const { identity, room, roomName } = req.body || {};

    const resolvedRoom = room || roomName;

    if (!identity || !resolvedRoom) {
      return res.status(400).json({
        error: 'identity and room are required',
      });
    }

    const accountSid = process.env.TWILIO_ACCOUNT_SID;
    const apiKeySid = process.env.TWILIO_API_KEY_SID;
    const apiKeySecret = process.env.TWILIO_API_KEY_SECRET;

    if (!accountSid || !apiKeySid || !apiKeySecret) {
      return res.status(500).json({
        error: 'missing_twilio_video_env',
      });
    }

    const AccessToken = twilio.jwt.AccessToken;
    const VideoGrant = AccessToken.VideoGrant;

    const token = new AccessToken(
      accountSid,
      apiKeySid,
      apiKeySecret,
      {
        identity: String(identity),
        ttl: 60 * 60,
      }
    );

    token.addGrant(
      new VideoGrant({
        room: String(resolvedRoom),
      })
    );

    return res.json({
      token: token.toJwt(),
    });
  } catch (e) {
    console.error('[video][token] error', {
      message: e?.message,
      code: e?.code,
      stack: e?.stack,
    });

    return res.status(500).json({
      error: 'failed_to_issue_token',
    });
  }
});

export default router;