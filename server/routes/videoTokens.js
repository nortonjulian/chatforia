import express from 'express';
import { requireAuth } from '../middleware/auth.js';

const router = express.Router();

const {
  TWILIO_ACCOUNT_SID,
  TWILIO_API_KEY_SID,
  TWILIO_API_KEY_SECRET,
} = process.env;

router.post('/video/token', requireAuth, async (req, res) => {
  try {
    const { identity, room } = req.body || {};

    if (!identity || !room) {
      return res.status(400).json({
        error: 'identity and room are required',
      });
    }

    if (!TWILIO_ACCOUNT_SID || !TWILIO_API_KEY_SID || !TWILIO_API_KEY_SECRET) {
      return res.status(500).json({
        error: 'missing_twilio_video_env',
      });
    }

    const mod = await import('twilio');
    const twilio = mod.default ?? mod;

    const AccessToken = twilio.jwt.AccessToken;
    const VideoGrant = AccessToken.VideoGrant;

    const token = new AccessToken(
      TWILIO_ACCOUNT_SID,
      TWILIO_API_KEY_SID,
      TWILIO_API_KEY_SECRET,
      {
        identity: String(identity),
        ttl: 60 * 60,
      }
    );

    token.addGrant(
      new VideoGrant({
        room: String(room),
      })
    );

    return res.json({
      token: token.toJwt(),
    });
  } catch (e) {
    console.error('[video][token] error', e);
    return res.status(500).json({
      error: 'failed_to_issue_token',
    });
  }
});

export default router;