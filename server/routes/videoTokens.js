import express from 'express';

const router = express.Router();

const {
  TWILIO_ACCOUNT_SID,
  TWILIO_API_KEY_SID,
  TWILIO_API_KEY_SECRET,
} = process.env;

router.post('/video/token', express.json(), async (req, res) => {
  try {
    const { identity, room } = req.body || {};
    if (!identity || !room) return res.status(400).json({ error: 'identity and room are required' });

    const mod = await import('twilio');
    const twilio = mod.default ?? mod;
    const { jwt } = twilio;

    const AccessToken = jwt.AccessToken;
    const VideoGrant = jwt.AccessToken.VideoGrant;

    const token = new AccessToken(
      TWILIO_ACCOUNT_SID,
      TWILIO_API_KEY_SID,
      TWILIO_API_KEY_SECRET,
      { ttl: 60 * 60 } // 1 hour; adjust as needed
    );

    token.identity = String(identity);
    token.addGrant(new VideoGrant({ room: String(room) }));

    return res.json({ token: token.toJwt() });
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('[video][token] error', e);
    res.status(500).json({ error: 'failed_to_issue_token' });
  }
});

export default router;
