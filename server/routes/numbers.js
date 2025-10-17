import express from 'express';
import prisma from '../utils/prismaClient.js';
// import * as telco from '../lib/telco/index.js';
import telco, { getProvider, providerName as defaultProviderName } from '../lib/telco/index.js';
import { requireAuth } from '../middleware/auth.js';
import { requirePremium } from '../middleware/requirePremium.js';

const router = express.Router();

async function resolveTwilioProvider() {
  if (typeof getProvider === 'function') return getProvider('twilio');
  return telco; // default export from telco/index.js should be Twilio adapter
}


/**
 * Pick a provider adapter for this request, with graceful fallbacks:
 * 1) explicit override (param/body)
 * 2) TELCO_PROVIDER env
 * 3) telco.providerName / default export
 *
 * Works with either:
 *  - telco.getProvider?(key) returning an adapter, OR
 *  - dynamic import of ../lib/telco/telnyx.js | bandwidth.js
 */
// async function pickProvider(nameMaybe) {
//   const key =
//     String(nameMaybe || process.env.TELCO_PROVIDER || telco.providerName || 'telnyx')
//       .trim()
//       .toLowerCase();

  // If the index exposes a registry:
  // if (typeof telco.getProvider === 'function') {
  //   const api = telco.getProvider(key);
  //   if (api) return api;
  // }

  // Fallback to dynamic import of known adapters
//   switch (key) {
//     case 'telnyx':
//       return (await import('../lib/telco/telnyx.js')).default;
//     case 'bandwidth':
//       return (await import('../lib/telco/bandwidth.js')).default;
//     default:
//       // Use the default module (must expose searchAvailable/purchaseNumber/releaseNumber)
//       return telco;
//   }
// }

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
 * GET /numbers/available?areaCode=303&limit=20&country=US&type=local&provider=telnyx|bandwidth
 * Search available numbers at chosen provider (or default).
 */
// router.get('/available', requireAuth, async (req, res) => {
//   const areaCode = req.query.areaCode ? String(req.query.areaCode) : undefined;
//   const limit = req.query.limit ? Number(req.query.limit) : 20;
//   const country = req.query.country ? String(req.query.country) : 'US';
//   const type = req.query.type ? String(req.query.type) : 'local';
//   const providerOverride = req.query.provider;

//   try {
//     const api = await pickProvider(providerOverride);
//     const { items } = await api.searchAvailable({ areaCode, country, type, limit });
//     res.json({ numbers: items, provider: api.providerName || providerOverride || process.env.TELCO_PROVIDER || telco.providerName || 'telnyx' });
//   } catch (err) {
//     console.error('Available search failed:', err);
//     res.status(502).json({ error: 'Number search failed' });
//   }
// });

router.get('/available', requireAuth, async (req, res) => {
  const areaCode = req.query.areaCode ? String(req.query.areaCode) : undefined;
  const limit = req.query.limit ? Number(req.query.limit) : 20;
  const country = req.query.country ? String(req.query.country) : 'US';
  const type = req.query.type ? String(req.query.type) : 'local';

  try {
    const api = await resolveTwilioProvider();
    const { items } = await api.searchAvailable({ areaCode, country, type, limit });
    res.json({ numbers: items, provider: api.providerName || defaultProviderName || 'twilio' });
  } catch (err) {
    console.error('Available search failed:', err);
    res.status(502).json({ error: 'Number search failed' });
  }
});

/**
 * POST /numbers/reserve
 * Body: { e164, provider? }
 * Reserve a number locally (shadow record) for N minutes.
 */
router.post('/reserve', requireAuth, async (req, res) => {
  const { e164, provider: providerOverride } = req.body || {};
  if (!e164) return res.status(400).json({ error: 'e164 required' });

  const ttlMinutes = Number(process.env.RESERVATION_MINUTES) || 10;
  const expiresAt = new Date(Date.now() + ttlMinutes * 60 * 1000);

  // try {
  //   const api = await pickProvider(providerOverride);
  //   const providerName = api.providerName || providerOverride || process.env.TELCO_PROVIDER || telco.providerName || 'telnyx';

  //   // Upsert local shadow record for the candidate number as RESERVED
  //   let phone = await prisma.phoneNumber.findUnique({ where: { e164 } });
  //   if (!phone) {
  //     phone = await prisma.phoneNumber.create({
  //       data: { e164, provider: providerName, status: 'RESERVED' },
  //     });
  //   } else {
  //     if (!['AVAILABLE', 'RESERVED'].includes(phone.status)) {
  //       return res.status(409).json({ error: 'Number not available' });
  //     }
  //     await prisma.phoneNumber.update({
  //       where: { id: phone.id },
  //       data: { status: 'RESERVED', provider: providerName },
  //     });
  //   }

  //   await prisma.numberReservation.create({
  //     data: { phoneNumberId: phone.id, userId: req.user.id, expiresAt },
  //   });

  //   res.json({ ok: true, expiresAt, provider: providerName });
  // } catch (err) {
  //   console.error('Reserve failed:', err);
  //   res.status(500).json({ error: 'Reserve failed' });
  // }

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
 * Body: { e164, provider? }
 * Finalize purchase at provider and assign to the user.
 */
router.post('/claim', requireAuth, async (req, res) => {
  const { e164, provider: providerOverride } = req.body || {};
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

    // Choose provider: explicit -> phone.provider -> env/default
    const api = await pickProvider(providerOverride || phone.provider);
    // const providerName = api.providerName || providerOverride || phone.provider || process.env.TELCO_PROVIDER || telco.providerName || 'telnyx';

    // // Provider purchase/provision
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
    console.error('Claim failed:', err);
    res.status(502).json({ error: 'Claim/purchase failed' });
  }
});

/**
 * POST /numbers/release
 * Body: { reason? }
 * Release current user’s number at the stored provider.
 */
router.post('/release', requireAuth, async (req, res) => {
  try {
    const phone = await prisma.phoneNumber.findFirst({
      where: { assignedUserId: req.user.id, status: { in: ['ASSIGNED', 'HOLD'] } },
    });
    if (!phone) return res.status(404).json({ error: 'No number' });

    const api = await pickProvider(phone.provider);
    await api.releaseNumber({ phoneNumber: phone.e164 });

    await prisma.phoneNumber.update({
      where: { id: phone.id },
      data: {
        status: 'RELEASING',
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
