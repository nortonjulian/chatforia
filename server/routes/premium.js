import express from 'express';
import prisma from '../utils/prismaClient.js';
import { requireAuth } from '../middleware/auth.js';
import { requirePremium } from '../middleware/requirePremium.js';
import { premiumConfig } from '../config/premiumConfig.js';
import { getPlanEntitlements } from '../config/planEntitlements.js';
import { getUsageSummary } from '../services/planUsageService.js';

const router = express.Router();

/** Entitlements snapshot (plan, caps, catalogs). */
router.get('/entitlements', requireAuth, async (req, res) => {
  const me = await prisma.user.findUnique({
    where: { id: req.user.id },
    select: { plan: true },
  });
  const plan = me?.plan || 'FREE';
  const isPremium = plan === 'PREMIUM';
  const planEntitlements = getPlanEntitlements(plan);
  const usageSummary = await getUsageSummary(req.user.id, plan);

  res.json({
    plan,
    entitlements: usageSummary.entitlements,
    monthKey: usageSummary.monthKey,
    usage: usageSummary.usage,
    deviceLimit: planEntitlements.deviceLimit,
    expireMaxDays: planEntitlements.expireMaxDays,
    tones: premiumConfig.tones,
    themes: premiumConfig.themes,
  });
});

/** Tone catalogs (with premium flags) + current selection. */
router.get('/tones', requireAuth, async (req, res) => {
  const me = await prisma.user.findUnique({
    where: { id: req.user.id },
    select: { plan: true, ringtone: true, messageTone: true },
  });
  const isPremium = me?.plan === 'PREMIUM';

  res.json({
    current: { ringtone: me?.ringtone, messageTone: me?.messageTone },
    catalog: {
      ringtone: [
        ...premiumConfig.tones.freeRingtones.map((id) => ({ id, premium: false })),
        ...premiumConfig.tones.premiumRingtones.map((id) => ({ id, premium: true })),
      ],
      messageTone: [
        ...premiumConfig.tones.freeMessageTones.map((id) => ({ id, premium: false })),
        ...premiumConfig.tones.premiumMessageTones.map((id) => ({ id, premium: true })),
      ],
    },
    canUsePremium: isPremium,
  });
});

/** Update tones (gates premium choices). */
router.patch('/tones', requireAuth, async (req, res) => {
  const { ringtone, messageTone } = req.body || {};
  const me = await prisma.user.findUnique({
    where: { id: req.user.id },
    select: { plan: true },
  });
  const isPremium = me?.plan === 'PREMIUM';

  const isPremiumR = ringtone
    ? premiumConfig.tones.premiumRingtones.includes(ringtone)
    : false;
  const isPremiumM = messageTone
    ? premiumConfig.tones.premiumMessageTones.includes(messageTone)
    : false;

  if ((ringtone && isPremiumR) || (messageTone && isPremiumM)) {
    if (!isPremium)
      return res
        .status(402)
        .json({ code: 'PREMIUM_REQUIRED', reason: 'TONES' });
  }

  const allowedR = [
    ...premiumConfig.tones.freeRingtones,
    ...(isPremium ? premiumConfig.tones.premiumRingtones : []),
  ];
  const allowedM = [
    ...premiumConfig.tones.freeMessageTones,
    ...(isPremium ? premiumConfig.tones.premiumMessageTones : []),
  ];

  const data = {};
  if (ringtone && allowedR.includes(ringtone)) data.ringtone = ringtone;
  if (messageTone && allowedM.includes(messageTone)) data.messageTone = messageTone;

  if (!Object.keys(data).length)
    return res
      .status(400)
      .json({ error: 'Nothing to update or tone not allowed' });

  const updated = await prisma.user.update({
    where: { id: req.user.id },
    data,
    select: { ringtone: true, messageTone: true },
  });

  res.json({ ok: true, user: updated });
});

/**
 * Theme catalogs & setter.
 * NOTE: requires a `theme` field on User, e.g.:
 *   theme String @default("light")
 * Add to your schema before enabling these routes.
 */
router.get('/themes', requireAuth, async (req, res) => {
  // If you haven't added `theme` to User yet, temporarily hardcode 'light'
  let me = null;
  try {
    me = await prisma.user.findUnique({
      where: { id: req.user.id },
      select: { plan: true, theme: true },
    });
  } catch {
    // fallback if field not present yet
    me = { plan: 'FREE', theme: 'light' };
  }

  const isPremium = me?.plan === 'PREMIUM';

  res.json({
    current: { theme: me?.theme || 'light' },
    catalog: [
      ...premiumConfig.themes.free.map((id) => ({ id, premium: false })),
      ...premiumConfig.themes.premium.map((id) => ({ id, premium: true })),
    ],
    canUsePremium: isPremium,
  });
});

router.patch('/theme', requireAuth, async (req, res) => {
  const { theme } = req.body || {};
  if (!theme) return res.status(400).json({ error: 'theme required' });

  // Check plan
  const me = await prisma.user.findUnique({
    where: { id: req.user.id },
    select: { plan: true },
  });
  const isPremium = me?.plan === 'PREMIUM';

  const free = new Set(premiumConfig.themes.free);
  const prem = new Set(premiumConfig.themes.premium);

  if (prem.has(theme) && !isPremium)
    return res.status(402).json({ code: 'PREMIUM_REQUIRED', reason: 'THEME' });
  if (!free.has(theme) && !prem.has(theme))
    return res.status(400).json({ error: 'Unknown theme' });

  // Update (will error if you haven't added `theme` to User yet)
  try {
    const updated = await prisma.user.update({
      where: { id: req.user.id },
      data: { theme },
      select: { theme: true },
    });
    res.json({ ok: true, user: updated });
  } catch {
    res.status(409).json({
      error:
        'Theme field not found on User. Add `theme String @default("light")` to your Prisma schema.',
    });
  }
});

/** Premium-only backups toggles (example placeholders). */
router.post('/backups/auto/enable', requireAuth, requirePremium, async (_req, res) => {
  res.json({ ok: true, message: 'Auto backups will run daily.' });
});

router.post('/backups/auto/disable', requireAuth, requirePremium, async (_req, res) => {
  res.json({ ok: true, message: 'Auto backups disabled.' });
});

export default router;
