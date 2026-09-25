import express from 'express';
import twilio from 'twilio';

const {
  webhook: twilioWebhook,
} = twilio;

import {
  syncRegulatoryBundleStatusBySid,
} from '../services/numberRegulatoryService.js';

const router = express.Router();

function getBundleSid(body) {
  const candidates = [
    body?.BundleSid,
    body?.bundleSid,
    body?.Sid,
    body?.sid,
  ];

  for (const candidate of candidates) {
    const value = String(
      candidate || ''
    ).trim();

    if (/^BU[a-f0-9]{32}$/i.test(value)) {
      return value;
    }
  }

  return null;
}

router.post(
  '/twilio/regulatory-status',
  twilioWebhook({
    validate: true,
  }),
  async (req, res) => {
    const bundleSid =
      getBundleSid(req.body);

    if (!bundleSid) {
      return res.status(400).json({
        ok: false,
        reason: 'invalid-bundle-sid',
      });
    }

    try {
      const result =
        await syncRegulatoryBundleStatusBySid({
          bundleSid,
        });

      if (
        result.reason === 'profile-not-found'
      ) {
        return res.status(200).json({
          ok: true,
          synchronized: false,
          reason: 'profile-not-found',
        });
      }

      if (
        result.reason === 'invalid-bundle-sid'
      ) {
        return res.status(400).json({
          ok: false,
          synchronized: false,
          reason: 'invalid-bundle-sid',
        });
      }

      return res.status(200).json({
        ok: true,
        synchronized: true,
        status:
          result.profile?.status || null,
      });
    } catch {
      return res.status(503).json({
        ok: false,
        synchronized: false,
        reason: 'synchronization-failed',
      });
    }
  }
);

export default router;
