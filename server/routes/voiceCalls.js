import express from 'express';
import twilio from 'twilio';
import { requireAuth } from '../middleware/auth.js';
import { normalizeE164, isE164 } from '../utils/phone.js';

const router = express.Router();

router.post('/pstn', requireAuth, async (req, res) => {
  try {
    const { to } = req.body || {};
    const userId = req.user.id;

    const dest = normalizeE164(to);
    if (!isE164(dest)) {
      return res.status(400).json({ error: 'Invalid phone number' });
    }

    const accountSid = process.env.TWILIO_ACCOUNT_SID;
    const authToken  = process.env.TWILIO_AUTH_TOKEN;
    const from       = process.env.TWILIO_FROM_NUMBER; // your Chatforia DID
    const baseUrl    = process.env.PUBLIC_BASE_URL || `${req.protocol}://${req.get('host')}`;

    if (!accountSid || !authToken || !from) {
      return res.status(500).json({ error: 'Twilio Voice not configured' });
    }

    const client = twilio(accountSid, authToken);

    // This hits your /webhooks/voice/alias/legA flow:
    const url = new URL('/webhooks/voice/alias/legA', baseUrl);
    url.searchParams.set('userId', String(userId));
    url.searchParams.set('from', from);
    url.searchParams.set('to', dest);

    const statusCallback = new URL('/webhooks/voice/status', baseUrl);

    const call = await client.calls.create({
      to: dest,
      from,
      url: url.toString(),
      statusCallback: statusCallback.toString(),
      statusCallbackEvent: ['initiated', 'ringing', 'answered', 'completed'],
    });

    return res.json({ success: true, callSid: call.sid });
  } catch (err) {
    console.error('[voice] pstn call error', err);
    return res.status(500).json({ error: 'Failed to start call' });
  }
});

export default router;
