import express from 'express';
import { requireAuth } from '../middleware/auth.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { getForwardingPrefs, updateForwardingPrefs } from '../services/forwardingService.js';

const r = express.Router();

function hasForwardingAccess(user) {
  if (user?.role === 'ADMIN') return true;

  const plan = String(user?.plan || 'FREE')
    .trim()
    .toUpperCase();

  return plan === 'PLUS' || plan === 'PREMIUM';
}

function attemptsToEnableForwarding(patch) {
  return (
    patch?.forwardingEnabledSms === true ||
    patch?.forwardingEnabledCalls === true
  );
}

// GET /settings/forwarding
r.get('/forwarding', requireAuth, asyncHandler(async (req, res) => {
  const prefs = await getForwardingPrefs(req.user.id);
  res.json(prefs);
}));

// PATCH /settings/forwarding
r.patch('/forwarding', requireAuth, express.json(), asyncHandler(async (req, res) => {
  const patch = req.body || {};

  if (
    attemptsToEnableForwarding(patch) &&
    !hasForwardingAccess(req.user)
  ) {
    return res.status(402).json({
      error: 'Forwarding requires Chatforia Plus or Premium.',
      code: 'FORWARDING_PLAN_REQUIRED',
    });
  }

  const prefs = await updateForwardingPrefs(req.user.id, patch);
  res.json(prefs);
}));

export default r;
