import express from 'express';
import { AccessToken } from 'livekit-server-sdk';

const router = express.Router();
const { LIVEKIT_API_KEY, LIVEKIT_API_SECRET, LIVEKIT_URL } = process.env;

router.post('/token', async (req, res) => {
  try {
    const { room, identity } = req.body || {};
    if (!room || !identity) return res.status(400).json({ error: 'room and identity required' });

    const at = new AccessToken(LIVEKIT_API_KEY, LIVEKIT_API_SECRET, {
      identity: String(identity),
    });
    at.addGrant({ room: String(room), roomJoin: true, canPublish: true, canSubscribe: true });

    res.json({ token: await at.toJwt(), url: LIVEKIT_URL });
  } catch (e) {
    console.error('[video] token error', e);
    res.status(500).json({ error: 'failed_to_create_token' });
  }
});

export default router;
