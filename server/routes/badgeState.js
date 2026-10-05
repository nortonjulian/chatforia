import express from 'express';
import { requireAuth } from '../middleware/auth.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { getBadgeState } from '../services/badgeState.js';

const router = express.Router();
router.use(requireAuth);

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const state = await getBadgeState(req.user.id);
    res.set('Cache-Control', 'private, no-store, no-cache, must-revalidate');
    res.json(state);
  })
);

export default router;
