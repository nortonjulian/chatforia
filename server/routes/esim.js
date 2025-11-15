import express from 'express';
import {
  listRegions,
  reserveProfile,
  activateProfile,
  suspendProfile,
  resumeProfile,
  handleTealWebhook,
} from '../controllers/esimController.js';

import { ESIM_ENABLED, TEAL } from '../config/esim.js';
// import { requireAuth } from '../middleware/auth.js'; // enable when ready

const router = express.Router();

/**
 * GET /esim/health
 * Basic read-only status for debugging (no secrets exposed)
 */
router.get('/health', (req, res) => {
  res.json({
    enabled: ESIM_ENABLED,
    baseUrlConfigured: Boolean(TEAL?.baseUrl),
    apiKeyConfigured: Boolean(TEAL?.apiKey),
    partnerId: TEAL?.partnerId ?? null,
    defaultPlanId: TEAL?.defaultPlanId ?? null,
  });
});

/**
 * GET /esim/regions
 * Exposes allowed regions (configurable via ESIM_REGIONS env)
 */
router.get('/regions', listRegions);

// --- eSIM actions (server → Teal). Protect with auth later ---
router.post('/profiles', /* requireAuth, */ reserveProfile);
router.post('/activate', /* requireAuth, */ activateProfile);
router.post('/suspend',  /* requireAuth, */ suspendProfile);
router.post('/resume',   /* requireAuth, */ resumeProfile);

/**
 * Webhook endpoint (Teal → server)
 * MUST use raw body for signature validation
 */
router.post(
  '/webhooks/teal',
  express.raw({ type: '*/*' }), // prevent JSON middleware from altering the body
  handleTealWebhook
);

export default router;
