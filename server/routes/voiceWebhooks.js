import express from 'express';
import rateLimit from 'express-rate-limit';
import twilio from 'twilio';
import { normalizeE164, isE164 } from '../utils/phone.js';

const { VoiceResponse } = twilio.twiml;
const router = express.Router();

// Twilio posts webhooks as x-www-form-urlencoded by default.
router.use(express.urlencoded({ extended: false }));

// Basic rate limit (tune as needed)
router.use(
  rateLimit({
    windowMs: 60_000,
    max: 60, // Twilio can retry; keep this lenient
    standardHeaders: true,
    legacyHeaders: false,
  })
);

/**
 * Helper: send TwiML XML with correct headers.
 */
function respondWithTwiML(res, vr) {
  const xml = typeof vr === 'string' ? vr : vr.toString();
  res.set('Content-Type', 'text/xml; charset=utf-8');
  return res.status(200).send(xml);
}

/**
 * POST /webhooks/voice/alias/legA
 * Query params (from startAliasCall):
 *   ?userId=<id>&from=<E164 Chatforia DID>&to=<E164 Destination>
 * Behavior:
 *   - Say "Press 1 to connect", Gather DTMF (1 digit)
 *   - On no input, say goodbye and hang up
 */
router.post('/alias/legA', (req, res) => {
  const userId = String(req.query.userId || '').trim();
  const from = normalizeE164(req.query.from);
  const to = normalizeE164(req.query.to);

  const vr = new VoiceResponse();

  // Validate required params; fail soft with a helpful message
  if (!userId || !isE164(from) || !isE164(to)) {
    vr.say({ voice: 'alice' }, 'We could not validate this call. Goodbye.');
    vr.hangup();
    return respondWithTwiML(res, vr);
  }

  // Twilio will POST digits to /webhooks/voice/alias/confirm with the same query params
  const actionUrl = new URL(req.originalUrl, `${req.protocol}://${req.get('host')}`);
  actionUrl.pathname = '/webhooks/voice/alias/confirm';
  actionUrl.searchParams.set('userId', userId);
  actionUrl.searchParams.set('from', from);
  actionUrl.searchParams.set('to', to);

  const gather = vr.gather({
    input: 'dtmf',
    numDigits: 1,
    action: actionUrl.toString(),
    method: 'POST',
    timeout: 6,
  });
  gather.say({ voice: 'alice' }, 'Chatforia. Press 1 to connect your call.');

  // If no input, Twilio continues with the rest of the response:
  vr.say({ voice: 'alice' }, 'No input received. Goodbye.');
  vr.hangup();

  return respondWithTwiML(res, vr);
});

/**
 * POST /webhooks/voice/alias/confirm
 * Body: Digits=1 when user pressed 1 during Gather.
 * Query: ?userId=<id>&from=<E164 Chatforia DID>&to=<E164 Destination>
 * Behavior:
 *   - If Digits === '1': say "Connecting" then <Dial> the destination with callerId set to from
 *   - Else: say "Cancelled" and hang up
 */
router.post('/alias/confirm', (req, res) => {
  const digits = String(req.body?.Digits || '').trim();
  const userId = String(req.query.userId || '').trim();
  const from = normalizeE164(req.query.from);
  const to = normalizeE164(req.query.to);

  const vr = new VoiceResponse();

  if (!userId || !isE164(from) || !isE164(to)) {
    vr.say({ voice: 'alice' }, 'We could not validate this call. Goodbye.');
    vr.hangup();
    return respondWithTwiML(res, vr);
  }

  if (digits === '1') {
    vr.say({ voice: 'alice' }, 'Connecting.');
    const dial = vr.dial({ callerId: from });
    dial.number({}, to); // Bridge this leg with destination
    // When destination answers, Twilio automatically bridges the calls.
  } else {
    vr.say({ voice: 'alice' }, 'Cancelled.');
    vr.hangup();
  }

  return respondWithTwiML(res, vr);
});

export default router;
