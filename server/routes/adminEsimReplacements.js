import express from 'express';

import {
  requireAuth,
  requireAdmin,
} from '../middleware/auth.js';

import {
  reconcileEsimReplacement,
  retryFailedEsimReplacement,
} from '../services/esimReplacementService.js';

const router = express.Router();

/*
 * eSIM replacement reconciliation is an operational recovery action.
 * Customers must never be able to invoke it directly.
 */
router.use(requireAuth, requireAdmin);

// POST /admin/esim-replacements/:replacementId/reconcile
router.post(
  '/:replacementId/reconcile',
  async (req, res, next) => {
    try {
      const replacementId =
        String(req.params.replacementId || '').trim();

      if (!replacementId) {
        return res.status(400).json({
          error: 'Invalid replacement id',
          code:
            'ESIM_REPLACEMENT_INVALID_REPLACEMENT_ID',
        });
      }

      const replacement =
        await reconcileEsimReplacement(
          replacementId
        );

      return res.json({
        ok: true,
        replacement,
      });
    } catch (err) {
      switch (err?.code) {
        case 'ESIM_REPLACEMENT_NOT_FOUND':
          return res.status(404).json({
            error: err.message,
            code: err.code,
          });

        case 'ESIM_REPLACEMENT_PROVIDER_OUTCOME_UNKNOWN':
        case 'ESIM_REPLACEMENT_NOT_RECONCILABLE':
          return res.status(409).json({
            error: err.message,
            code: err.code,
          });

        case 'ESIM_REPLACEMENT_INVALID_REPLACEMENT_ID':
          return res.status(400).json({
            error: err.message,
            code: err.code,
          });

        default:
          return next(err);
      }
    }
  }
);


/*
 * Retry is intentionally narrower than reconciliation.
 *
 * It is only for a definite FAILED replacement whose previously
 * allocated replacement ICCID can safely be reused. The service,
 * not the request body, owns all provider/allocation/entitlement
 * state used by the retry.
 */
// POST /admin/esim-replacements/:replacementId/retry
router.post(
  '/:replacementId/retry',
  async (req, res, next) => {
    try {
      const replacementId =
        String(req.params.replacementId || '').trim();

      if (!replacementId) {
        return res.status(400).json({
          error: 'Invalid replacement id',
          code:
            'ESIM_REPLACEMENT_INVALID_REPLACEMENT_ID',
        });
      }

      const replacement =
        await retryFailedEsimReplacement(
          replacementId
        );

      return res.json({
        ok: true,
        replacement,
      });
    } catch (err) {
      switch (err?.code) {
        case 'ESIM_REPLACEMENT_NOT_FOUND':
          return res.status(404).json({
            error: err.message,
            code: err.code,
          });

        case 'ESIM_REPLACEMENT_NOT_RETRYABLE':
        case 'ESIM_REPLACEMENT_RETRY_ALREADY_CLAIMED':
        case 'ESIM_REPLACEMENT_RETRY_ALLOCATION_MISSING':
        case 'ESIM_REPLACEMENT_RETRY_PROVIDER_PACKAGE_EXISTS':
        case 'ESIM_REPLACEMENT_RETRY_DATA_MISSING':
        case 'ESIM_REPLACEMENT_EXPIRED':
          return res.status(409).json({
            error: err.message,
            code: err.code,
          });

        case 'ESIM_REPLACEMENT_INVALID_REPLACEMENT_ID':
          return res.status(400).json({
            error: err.message,
            code: err.code,
          });

        default:
          return next(err);
      }
    }
  }
);

export default router;
