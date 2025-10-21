import express from 'express';
import { recordInboundSms } from '../services/smsService.js';

const router = express.Router();

/**
 * POST /_dev/sms/inbound
 * { from:"+15551234567", to:"+15550002222", body:"Hello from dev!" }
 */
router.post('/_dev/sms/inbound', express.json(), async (req, res, next) => {
  try {
    const { from, to, body } = req.body || {};
    if (!from || !to || !body) {
      return res.status(400).json({ error: 'from, to, and body are required' });
    }
    const out = await recordInboundSms({
      toNumber: to,
      fromNumber: from,
      body,
      provider: 'mock',
    });
    res.json({ ok: true, ...out });
  } catch (e) {
    next(e);
  }
});

export default router;
