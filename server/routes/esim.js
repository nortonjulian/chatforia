import express from 'express';
import {
  listRegions,
  reserveProfile,
  activateProfile,
  suspendProfile,
  resumeProfile,
  handleEsimWebhook,
  getMyEsim, // ✅ NEW
} from '../controllers/esimController.js';

import { ESIM_ENABLED, ESIM_PROVIDER, getEsimProviderConfig } from '../config/esim.js';
import { requireAuth } from '../middleware/auth.js'; // ✅ ENABLED

const router = express.Router();

/**
 * GET /esim/health
 * Basic read-only status for debugging (no secrets exposed)
 */
router.get('/health', (req, res) => {
  const provider = ESIM_PROVIDER || 'oneglobal';
  const cfg = getEsimProviderConfig(provider); // ✅ FIXED

  res.json({
    enabled: ESIM_ENABLED,
    provider,
    baseUrlConfigured: Boolean(cfg?.baseUrl),
    apiKeyConfigured: Boolean(cfg?.apiKey),
    partnerId: cfg?.partnerId ?? null,
    defaultPlanId: cfg?.defaultPlanId ?? null,
  });
});

/**
 * GET /esim/regions
 * Exposes allowed regions (configurable via ESIM_REGIONS env)
 */
router.get('/regions', listRegions);

/**
 * GET /esim/me
 * Returns the current user's saved eSIM (QR, activation data, status)
 */
router.get('/me', requireAuth, getMyEsim); // ✅ NEW

// --- eSIM actions (server → provider) ---
router.post('/profiles', requireAuth, reserveProfile); // ✅ NOW PROTECTED
router.post('/activate', requireAuth, activateProfile);
router.post('/suspend', requireAuth, suspendProfile);
router.post('/resume', requireAuth, resumeProfile);

/**
 * Webhook endpoint (provider → server)
 * MUST use raw body for signature validation
 *
 * You’ll point provider webhook URL to this path.
 */
router.post(
  '/webhooks/oneglobal',
  express.raw({ type: '*/*' }),
  handleEsimWebhook
);

export default router;