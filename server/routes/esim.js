import express from 'express';
import {
  listRegions,
  reserveProfile,
  activateProfile,
  suspendProfile,
  resumeProfile,
  handleEsimWebhook,
} from '../controllers/esimController.js';

import { ESIM_ENABLED, TELNA } from '../config/esim.js';
// import { requireAuth } from '../middleware/auth.js'; // enable when ready

const router = express.Router();

/**
 * GET /esim/health
 * Basic read-only status for debugging (no secrets exposed)
 */
router.get('/health', (req, res) => {
  res.json({
    enabled: ESIM_ENABLED,
    provider: 'telna',
    baseUrlConfigured: Boolean(TELNA?.baseUrl),
    apiKeyConfigured: Boolean(TELNA?.apiKey),
    partnerId: TELNA?.partnerId ?? null,
    defaultPlanId: TELNA?.defaultPlanId ?? null,
  });
});

/**
 * GET /esim/regions
 * Exposes allowed regions (configurable via ESIM_REGIONS env)
 */
router.get('/regions', listRegions);

// --- eSIM actions (server → provider). Protect with auth later ---
router.post('/profiles', /* requireAuth, */ reserveProfile);
router.post('/activate', /* requireAuth, */ activateProfile);
router.post('/suspend',  /* requireAuth, */ suspendProfile);
router.post('/resume',   /* requireAuth, */ resumeProfile);

/**
 * Webhook endpoint (provider → server)
 * MUST use raw body for signature validation
 *
 * You’ll point Telna’s webhook URL to this path.
 */
router.post(
  '/webhooks/telna',
  express.raw({ type: '*/*' }), // prevent JSON middleware from altering the body
  handleEsimWebhook
);

export default router;
