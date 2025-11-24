import express from 'express';
import { requireAuth } from '../middleware/auth.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { startAliasCall } from '../services/voiceBridge.js';
import logger from '../utils/logger.js'; // optional, but correct

const r = express.Router();

// POST /voice/call { to }
r.post(
  '/call',
  requireAuth,
  express.json(),
  asyncHandler(async (req, res) => {
    const { to } = req.body || {};

    logger?.info?.(
      { userId: req.user.id, to },
      'Placing alias call from /voice/call'
    );

    const out = await startAliasCall({ userId: req.user.id, to });
    res.status(202).json(out);
  })
);

export default r;
