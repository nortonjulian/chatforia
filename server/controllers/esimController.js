import { ENV } from '../config/env.js';
import { ESIM_ENABLED, ESIM_PROVIDER } from '../config/esim.js';
import * as esimProvider from '../services/providers/esimProvider.js';
import prisma from '../utils/prismaClient.js';

function isEnabled() {
  // Prefer ESIM_ENABLED from config/esim.js, but fall back to ENV.FEATURE_ESIM
  if (typeof ESIM_ENABLED === 'boolean') {
    return ESIM_ENABLED;
  }
  const v = ENV?.FEATURE_ESIM;
  return v === true || String(v).toLowerCase() === 'true';
}

function ensureEnabled(res) {
  if (!isEnabled()) {
    res.status(403).json({ error: 'eSIM feature is disabled' });
    return false;
  }
  return true;
}

/**
 * GET /esim/regions
 * Returns a configurable list of supported regions.
 * Configure via ESIM_REGIONS (comma-separated), e.g. "US,EU,UK,CA,AU,JP"
 */
export async function listRegions(_req, res) {
  const regions = (process.env.ESIM_REGIONS ||
    'US,EU,UK,CA,AU,JP,MX,BR,IN,ZA,SG,HK,KR,AE')
    .split(',')
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean);

  return res.json({ regions });
}

/**
 * GET /esim/me
 * Returns the latest saved eSIM/subscriber record for the authenticated user.
 */
export async function getMyEsim(req, res) {
  if (!ensureEnabled(res)) return;

  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    const subscriber = await prisma.subscriber.findFirst({
      where: { userId: Number(userId) },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        provider: true,
        providerProfileId: true,
        iccid: true,
        iccidHint: true,
        smdp: true,
        activationCode: true,
        lpaUri: true,
        qrPayload: true,
        msisdn: true,
        region: true,
        status: true,
        activatedAt: true,
        suspendedAt: true,
        expiresAt: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    return res.json({ subscriber: subscriber || null });
  } catch (err) {
    console.error('[esim] getMyEsim error:', err);
    return res.status(500).json({ error: 'Failed to load eSIM profile' });
  }
}

export async function reserveProfile(req, res) {
  if (!ensureEnabled(res)) return;

  try {
    const regionRaw = req.body?.region ?? 'US';
    const region = String(regionRaw).trim().toUpperCase();
    const userId = req.user?.id ?? null; // assumes auth middleware

    if (typeof esimProvider.reserveEsimProfile !== 'function') {
      return res
        .status(501)
        .json({ error: 'reserveEsimProfile not implemented' });
    }

    const data = await esimProvider.reserveEsimProfile({ userId, region });
    if (!data || typeof data !== 'object') {
      return res
        .status(502)
        .json({ error: 'Invalid response from eSIM provider' });
    }

    const providerProfileId = data.providerProfileId || null;
    const iccid = data.iccid || null;
    const iccidHint = data.iccidHint || data.iccid || null;
    const smdp = data.smdp || data.smDpPlus || null;
    const activationCode = data.activationCode || data.matchingId || null;

    // Prefer API-provided QR payload; otherwise build a standards-compliant LPA URI
    const lpaUri =
      data.lpaUri ||
      data.qrPayload ||
      (smdp && activationCode ? `LPA:1$${smdp}$${activationCode}` : null);

    const qrPayload = data.qrPayload || lpaUri || null;

    // Persist the reserved eSIM for the authenticated user
    if (userId) {
      const existing = await prisma.subscriber.findFirst({
        where: {
          userId: Number(userId),
          OR: [
            { status: 'PENDING' },
            { status: 'PROVISIONING' },
            { status: 'ACTIVE' },
            { status: 'SUSPENDED' },
          ],
        },
        orderBy: { createdAt: 'desc' },
      });

      if (existing) {
        await prisma.subscriber.update({
          where: { id: existing.id },
          data: {
            provider: ESIM_PROVIDER || 'unknown',
            providerProfileId,
            iccid,
            iccidHint,
            smdp,
            activationCode,
            lpaUri,
            qrPayload,
            region,
            status: existing.status || 'PENDING',
            providerMeta: data,
          },
        });
      } else {
        await prisma.subscriber.create({
          data: {
            userId: Number(userId),
            provider: ESIM_PROVIDER || 'unknown',
            providerProfileId,
            iccid,
            iccidHint,
            smdp,
            activationCode,
            lpaUri,
            qrPayload,
            region,
            status: 'PENDING',
            providerMeta: data,
          },
        });
      }

      // Keep legacy iccid field on user in sync if present
      if (iccid) {
        await prisma.user.update({
          where: { id: Number(userId) },
          data: { iccid },
        });
      }
    }

    return res.json({
      providerProfileId,
      iccid,
      iccidHint,
      smdp,
      activationCode,
      lpaUri,
      qrPayload,
      region,
    });
  } catch (err) {
    console.error('[esim] reserveProfile error:', err);
    return res.status(500).json({ error: 'Failed to reserve eSIM profile' });
  }
}

export async function activateProfile(req, res) {
  if (!ensureEnabled(res)) return;

  try {
    if (typeof esimProvider.activateProfile !== 'function') {
      return res
        .status(501)
        .json({ error: 'activateProfile not implemented' });
    }

    const iccid = String(req.body?.iccid || '').trim();
    const activationCode = String(req.body?.code || req.body?.activationCode || '').trim();
    const providerProfileId = String(req.body?.providerProfileId || '').trim();

    if (!iccid && !activationCode && !providerProfileId) {
      return res.status(400).json({
        error: 'providerProfileId, iccid, or activationCode is required',
      });
    }

    const out = await esimProvider.activateProfile({
      iccid: iccid || undefined,
      activationCode: activationCode || undefined,
      providerProfileId: providerProfileId || undefined,
    });

    const userId = req.user?.id ?? null;

    if (userId) {
      const existing = await prisma.subscriber.findFirst({
        where: {
          userId: Number(userId),
          OR: [
            providerProfileId ? { providerProfileId } : undefined,
            iccid ? { iccid } : undefined,
            activationCode ? { activationCode } : undefined,
          ].filter(Boolean),
        },
        orderBy: { createdAt: 'desc' },
      });

      if (existing) {
        await prisma.subscriber.update({
          where: { id: existing.id },
          data: {
            status: 'ACTIVE',
            activatedAt: out?.activatedAt ? new Date(out.activatedAt) : new Date(),
            msisdn: out?.msisdn || existing.msisdn || null,
            providerMeta: out || undefined,
          },
        });
      }
    }

    return res.json({ ok: true, ...out });
  } catch (err) {
    console.error('[esim] activateProfile error:', err);
    return res.status(500).json({ error: 'Failed to activate eSIM profile' });
  }
}

export async function suspendProfile(req, res) {
  if (!ensureEnabled(res)) return;

  try {
    if (typeof esimProvider.suspendLine !== 'function') {
      return res
        .status(501)
        .json({ error: 'suspendLine not implemented' });
    }

    const iccid = String(req.body?.iccid || '').trim();
    const providerProfileId = String(req.body?.providerProfileId || '').trim();

    if (!iccid && !providerProfileId) {
      return res.status(400).json({
        error: 'iccid or providerProfileId is required',
      });
    }

    const out = await esimProvider.suspendLine({
      iccid: iccid || undefined,
      providerProfileId: providerProfileId || undefined,
    });

    const userId = req.user?.id ?? null;

    if (userId) {
      const existing = await prisma.subscriber.findFirst({
        where: {
          userId: Number(userId),
          OR: [
            providerProfileId ? { providerProfileId } : undefined,
            iccid ? { iccid } : undefined,
          ].filter(Boolean),
        },
        orderBy: { createdAt: 'desc' },
      });

      if (existing) {
        await prisma.subscriber.update({
          where: { id: existing.id },
          data: {
            status: 'SUSPENDED',
            suspendedAt: new Date(),
            providerMeta: out || undefined,
          },
        });
      }
    }

    return res.json({ ok: true, ...out });
  } catch (err) {
    console.error('[esim] suspendProfile error:', err);
    return res.status(500).json({ error: 'Failed to suspend eSIM line' });
  }
}

export async function resumeProfile(req, res) {
  if (!ensureEnabled(res)) return;

  try {
    if (typeof esimProvider.resumeLine !== 'function') {
      return res
        .status(501)
        .json({ error: 'resumeLine not implemented' });
    }

    const iccid = String(req.body?.iccid || '').trim();
    const providerProfileId = String(req.body?.providerProfileId || '').trim();

    if (!iccid && !providerProfileId) {
      return res.status(400).json({
        error: 'iccid or providerProfileId is required',
      });
    }

    const out = await esimProvider.resumeLine({
      iccid: iccid || undefined,
      providerProfileId: providerProfileId || undefined,
    });

    const userId = req.user?.id ?? null;

    if (userId) {
      const existing = await prisma.subscriber.findFirst({
        where: {
          userId: Number(userId),
          OR: [
            providerProfileId ? { providerProfileId } : undefined,
            iccid ? { iccid } : undefined,
          ].filter(Boolean),
        },
        orderBy: { createdAt: 'desc' },
      });

      if (existing) {
        await prisma.subscriber.update({
          where: { id: existing.id },
          data: {
            status: 'ACTIVE',
            suspendedAt: null,
            providerMeta: out || undefined,
          },
        });
      }
    }

    return res.json({ ok: true, ...out });
  } catch (err) {
    console.error('[esim] resumeProfile error:', err);
    return res.status(500).json({ error: 'Failed to resume eSIM line' });
  }
}

/**
 * POST /esim/webhooks/oneglobal
 * Webhook endpoint called by the eSIM provider to notify about line/profile events.
 * (Currently just logs + 200; expand when you wire up real DB updates.)
 */
export async function handleEsimWebhook(req, res) {
  try {
    console.info('[esim] provider webhook received:', {
      headers: req.headers,
      body: req.body,
    });

    // TODO: parse event, update DB, etc.
    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('[esim] provider webhook error:', err);
    return res.status(500).json({ error: 'Failed to process eSIM webhook' });
  }
}