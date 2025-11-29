import express from 'express';
import prisma from '../utils/prismaClient.js';
import telco, { getProvider, providerName as defaultProviderName } from '../lib/telco/index.js';
import { requireAuth } from '../middleware/auth.js';
import { requirePremium } from '../middleware/requirePremium.js';

const router = express.Router();

/**
 * Resolve the Twilio provider adapter.
 * - If getProvider('twilio') exists, use that
 * - Otherwise fall back to default export, which should be Twilio
 */
async function resolveTwilioProvider() {
  if (typeof getProvider === 'function') {
    const api = getProvider('twilio');
    if (api) return api;
  }
  return telco;
}

/** Policy helper (shown to client) */
function getPolicy() {
  const inactivityDays = Number(process.env.NUMBER_INACTIVITY_DAYS) || 30;
  const holdDays = Number(process.env.NUMBER_HOLD_DAYS) || 14;
  return { inactivityDays, holdDays };
}

/**
 * GET /numbers/my
 * Current assignment + policy
 */
router.get('/my', requireAuth, async (req, res) => {
  const num = await prisma.phoneNumber.findFirst({
    where: {
      assignedUserId: req.user.id,
      status: { in: ['ASSIGNED', 'HOLD'] },
    },
  });
  res.json({ number: num, policy: getPolicy() });
});

/**
 * GET /numbers/available?areaCode=303&limit=20&country=US&type=local
 * Search available numbers at Twilio.
 */
router.get('/available', requireAuth, async (req, res) => {
  const areaCode = req.query.areaCode ? String(req.query.areaCode) : undefined;
  const limit = req.query.limit ? Number(req.query.limit) : 20;
  const country = req.query.country ? String(req.query.country) : 'US';
  const type = req.query.type ? String(req.query.type) : 'local';

  try {
    const api = await resolveTwilioProvider();
    const { items } = await api.searchAvailable({ areaCode, country, type, limit });

    res.json({
      numbers: items,
      provider: api.providerName || defaultProviderName || 'twilio',
    });
  } catch (err) {
    console.error('Available search failed:', err);
    res.status(502).json({ error: 'Number search failed' });
  }
});

/**
 * POST /numbers/reserve
 * Body: { e164 }
 * Reserve a number locally (shadow record) for N minutes.
 */
router.post('/reserve', requireAuth, async (req, res) => {
  const { e164 } = req.body || {};
  if (!e164) return res.status(400).json({ error: 'e164 required' });

  const ttlMinutes = Number(process.env.RESERVATION_MINUTES) || 10;
  const expiresAt = new Date(Date.now() + ttlMinutes * 60 * 1000);

  try {
    const api = await resolveTwilioProvider();
    const providerName = api.providerName || defaultProviderName || 'twilio';

    // Upsert local shadow record for the candidate number as RESERVED
    let phone = await prisma.phoneNumber.findUnique({ where: { e164 } });
    if (!phone) {
      phone = await prisma.phoneNumber.create({
        data: { e164, provider: providerName, status: 'RESERVED' },
      });
    } else {
      if (!['AVAILABLE', 'RESERVED'].includes(phone.status)) {
        return res.status(409).json({ error: 'Number not available' });
      }
      await prisma.phoneNumber.update({
        where: { id: phone.id },
        data: { status: 'RESERVED', provider: providerName },
      });
    }

    await prisma.numberReservation.create({
      data: { phoneNumberId: phone.id, userId: req.user.id, expiresAt },
    });

    res.json({ ok: true, expiresAt, provider: providerName });
  } catch (err) {
    console.error('Reserve failed:', err);
    res.status(500).json({ error: 'Reserve failed' });
  }
});

/**
 * POST /numbers/claim
 * Body: { e164 }
 * Finalize purchase at Twilio and assign to the user.
 */
router.post('/claim', requireAuth, async (req, res) => {
  const { e164 } = req.body || {};
  if (!e164) return res.status(400).json({ error: 'e164 required' });

  try {
    // Verify reservation belongs to requester and not expired
    const phone = await prisma.phoneNumber.findUnique({ where: { e164 } });
    if (!phone) return res.status(404).json({ error: 'Not reserved' });

    const reservation = await prisma.numberReservation.findFirst({
      where: { phoneNumberId: phone.id, userId: req.user.id },
      orderBy: { createdAt: 'desc' },
    });
    if (!reservation || reservation.expiresAt < new Date()) {
      return res.status(410).json({ error: 'Reservation expired' });
    }

    const api = await resolveTwilioProvider();
    const providerName = api.providerName || defaultProviderName || 'twilio';

    // Purchase/provision on Twilio
    const result = await api.purchaseNumber({ phoneNumber: e164 });
    // Optionally configure routes/webhooks here:
    // await api.configureWebhooks?.(e164);

    // Assign locally
    await prisma.phoneNumber.update({
      where: { id: phone.id },
      data: {
        status: 'ASSIGNED',
        assignedUserId: req.user.id,
        assignedAt: new Date(),
        provider: providerName,
      },
    });

    res.json({ ok: true, provider: providerName, order: result?.order || null });
  } catch (err) {
    console.error('Claim failed:', {
      message: err?.message,
      code: err?.code,
      status: err?.status,
      moreInfo: err?.moreInfo,
      details: err?.details,
      stack: err?.stack,
    });
    res.status(502).json({ error: 'Claim/purchase failed' });
  }
});

/**
 * POST /numbers/release
 * Body: { reason? }
 * Release current user’s number at Twilio.
 */
router.post('/release', requireAuth, async (req, res) => {
  try {
    const phone = await prisma.phoneNumber.findFirst({
      where: {
        assignedUserId: req.user.id,
        status: { in: ['ASSIGNED', 'HOLD'] },
      },
    });
    if (!phone) return res.status(404).json({ error: 'No number' });

    const api = await resolveTwilioProvider();
    await api.releaseNumber({ phoneNumber: phone.e164 });

    // Locally mark as AVAILABLE again (no more RELEASING enum)
    await prisma.phoneNumber.update({
      where: { id: phone.id },
      data: {
        status: 'AVAILABLE',
        assignedUserId: null,
        assignedAt: null,
        keepLocked: false,
        holdUntil: null,
        releaseAfter: null,
      },
    });

    res.json({ ok: true });
  } catch (err) {
    console.error('Release failed:', err);
    res.status(502).json({ error: 'Release failed' });
  }
});

/**
 * POST /numbers/keep/enable  (Premium)
 */
router.post('/keep/enable', requireAuth, requirePremium, async (req, res) => {
  const phone = await prisma.phoneNumber.findFirst({
    where: { assignedUserId: req.user.id, status: { in: ['ASSIGNED', 'HOLD'] } },
  });
  if (!phone) return res.status(404).json({ error: 'No number' });

  await prisma.phoneNumber.update({
    where: { id: phone.id },
    data: { keepLocked: true },
  });

  res.json({ ok: true });
});

/**
 * POST /numbers/keep/disable
 */
router.post('/keep/disable', requireAuth, async (req, res) => {
  const phone = await prisma.phoneNumber.findFirst({
    where: { assignedUserId: req.user.id, status: { in: ['ASSIGNED', 'HOLD'] } },
  });
  if (!phone) return res.status(404).json({ error: 'No number' });

  await prisma.phoneNumber.update({
    where: { id: phone.id },
    data: { keepLocked: false },
  });

  res.json({ ok: true });
});

export default router;
