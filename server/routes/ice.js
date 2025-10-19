import express from 'express';
import rateLimit from 'express-rate-limit';
import twilio from 'twilio';

const router = express.Router();

// 20 req/min IP rate limit (adjust if needed)
router.use(rateLimit({ windowMs: 60_000, max: 20 }));

/**
 * Build ICE servers from env for Telnyx and Bandwidth.
 * Supports:
 *   - STUN: TELNYX_STUN, BW_STUN (defaults provided)
 *   - TURN: TELNYX_TURN_URL/USER/PASS, BW_TURN_URL/USER/PASS
 *
 * Optional query:
 *   GET /ice-servers?provider=telnyx | bandwidth | all (default: all)
 *
 * NOTE:
 * For Twilio, we prefer dynamic TURN creds via /token (below).
 * This GET route returns static env-based ICE only (no secrets minted).
 */
router.get('/', (req, res) => {
  const provider = String(req.query.provider || 'all').toLowerCase();

  const TWILIO_STUN = process.env.TWILIO_STUN || 'stun:global.stun.twilio.com:3478';
  const turnUrl = process.env.TWILIO_TURN_URL || '';
  const turnUser = process.env.TWILIO_TURN_USER || '';
  const turnPass = process.env.TWILIO_TURN_PASS || '';

  // --- STUN defaults (safe to ship both) ---
  // const TELNYX_STUN = process.env.TELNYX_STUN || 'stun:stun.telnyx.com:3478';
  // const BW_STUN     = process.env.BW_STUN     || 'stun:stun.l.google.com:19302'; // Bandwidth doesn’t require their own STUN; Google STUN is fine as a second.

  // --- Telnyx TURN (optional) ---
  // const tTurn = (process.env.TELNYX_TURN_URL && process.env.TELNYX_TURN_USER && process.env.TELNYX_TURN_PASS)
  //   ? {
  //       urls: process.env.TELNYX_TURN_URL,      // e.g. turn:turn.telnyx.com:3478
  //       username: process.env.TELNYX_TURN_USER,
  //       credential: process.env.TELNYX_TURN_PASS,
  //     }
  //   : null;

  // --- Bandwidth TURN (optional) ---
  // const bTurn = (process.env.BW_TURN_URL && process.env.BW_TURN_USER && process.env.BW_TURN_PASS)
  //   ? {
  //       urls: process.env.BW_TURN_URL,          // e.g. turn:turn.bandwidth.com:3478
  //       username: process.env.BW_TURN_USER,
  //       credential: process.env.BW_TURN_PASS,
  //     }
  //   : null;

  // Build per-provider arrays
  // const telnyxICE = [
  //   { urls: TELNYX_STUN },
  //   ...(tTurn ? [tTurn] : []),
  // ];

  // const bandwidthICE = [
  //   { urls: BW_STUN },
  //   ...(bTurn ? [bTurn] : []),
  // ];

  // Merge by provider preference
  // let iceServers = [];
  // if (provider === 'telnyx')         iceServers = telnyxICE;
  // else if (provider === 'bandwidth') iceServers = bandwidthICE;
  // else /* all */                     iceServers = [...telnyxICE, ...bandwidthICE];

  // For Twilio (static env-based). Prefer POST /token below for dynamic creds.
  const iceServersRaw = [
    { urls: TWILIO_STUN },
    ...(turnUrl && turnUser && turnPass
      ? [{ urls: turnUrl, username: turnUser, credential: turnPass }]
      : []),
  ];

  // Deduplicate by (urls, username, credential) to keep the payload tidy
  const seen = new Set();
  const iceServers = iceServersRaw.filter(s => {
    const urls = Array.isArray(s.urls) ? s.urls.join(',') : s.urls;
    const key = `${urls}|${s.username || ''}|${s.credential || ''}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  res.json({ iceServers });
});

/**
 * Twilio Network Traversal: mint dynamic TURN creds
 * POST /ice-servers/token
 * Returns: { iceServers: [...] }
 *
 * Uses:
 *   TWILIO_ACCOUNT_SID
 *   TWILIO_AUTH_TOKEN
 *
 * Client flow:
 *   1) POST to this endpoint (authenticated by your app’s session/JWT).
 *   2) Use returned iceServers when creating RTCPeerConnection.
 *
 * Benefit:
 *   - Rotating credentials with TTL, safer than static TURN user/pass.
 */
router.post('/token', async (req, res) => {
  try {
    const sid = process.env.TWILIO_ACCOUNT_SID;
    const auth = process.env.TWILIO_AUTH_TOKEN;

    if (!sid || !auth) {
      return res.status(500).json({ error: 'Twilio credentials not configured' });
    }

    const client = twilio(sid, auth);
    const token = await client.tokens.create(); // response: { iceServers: [...] }
    // You can optionally filter/transform here (e.g., strip expiry if undesired).
    res.json({ iceServers: token.iceServers || [] });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[ice] /token error:', err);
    res.status(500).json({ error: 'Failed to fetch ICE servers from Twilio' });
  }
});

export default router;
