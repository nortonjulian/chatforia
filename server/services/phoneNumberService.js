import Boom from '@hapi/boom';
import prisma from '../utils/prismaClient.js';
import telco, { getProvider, providerName as defaultProviderName } from '../lib/telco/index.js';
import { normalizeE164, isE164 } from '../utils/phone.js';

function now() {
  return new Date();
}

async function resolveTwilioProvider() {
  if (typeof getProvider === 'function') {
    const api = getProvider('twilio');
    if (api) return api;
  }
  return telco; // default export
}

/**
 * Policy helper (exposed to client)
 * - Free: AUTO_RECYCLE (inactivity → HOLD → AVAILABLE)
 * - Premium: keepLocked prevents auto recycle
 */
export function getNumberPolicy(plan = 'FREE') {
  const inactivityDays = Number(process.env.NUMBER_INACTIVITY_DAYS) || 30;
  const holdDays = Number(process.env.NUMBER_HOLD_DAYS) || 14;

  const p = String(plan || 'FREE').toUpperCase();

  if (p === 'PREMIUM') {
    return {
      mode: 'PROTECTED',
      inactivityDays: null,
      holdDays: null,
      description: 'Your number is protected from automatic recycling while your subscription is active.',
    };
  }

  return {
    mode: 'AUTO_RECYCLE',
    inactivityDays,
    holdDays,
    description: 'Numbers may be recycled after inactivity on the Free plan.',
  };
}

/**
 * Search provider inventory (Twilio available numbers API)
 * This is NOT your local pool yet — it’s “what could be provisioned”.
 */
export async function searchAvailableNumbers({
  areaCode,
  postalCode,
  country = 'US',
  type = 'local',
  limit = 20,
} = {}) {
  const api = await resolveTwilioProvider();
  const { items } = await api.searchAvailable({ areaCode, postalCode, country, type, limit });

  return {
    numbers: items,
    provider: api.providerName || defaultProviderName || 'twilio',
  };
}

/**
 * Reserve a number locally (optional step)
 * - This DOES NOT buy it at Twilio.
 * - It’s only a short “hold” while the user picks.
 */
export async function reserveNumber({ userId, e164, ttlMinutes = 10 }) {
  const uid = Number(userId);
  const num = normalizeE164(e164);

  if (!uid) throw Boom.badRequest('Invalid userId');
  if (!isE164(num)) throw Boom.badRequest('Invalid e164');

  const expiresAt = new Date(Date.now() + ttlMinutes * 60 * 1000);

  // Ensure number is not already assigned/held by someone else
  let phone = await prisma.phoneNumber.findUnique({ where: { e164: num } });

  if (!phone) {
    phone = await prisma.phoneNumber.create({
      data: {
        e164: num,
        provider: 'twilio',
        status: 'RESERVED',
        source: 'PROVISIONED',
      },
    });
  } else {
    if (!['AVAILABLE', 'RESERVED'].includes(phone.status)) {
      throw Boom.conflict('Number not available');
    }
    phone = await prisma.phoneNumber.update({
      where: { id: phone.id },
      data: { status: 'RESERVED' },
    });
  }

  await prisma.numberReservation.create({
    data: { phoneNumberId: phone.id, userId: uid, expiresAt },
  });

  return { ok: true, e164: num, expiresAt };
}

/**
 * Claim a number:
 * - If it already exists in Twilio as an IncomingPhoneNumber (your pool), attach it to the user (ASSIGNED).
 * - If it’s not yet owned by Chatforia, this is the moment you call purchaseNumber().
 *
 * NOTE: For the “free pool” model, you typically pre-buy batches and just assign from AVAILABLE.
 * But we support both.
 */
export async function claimNumber({ userId, e164 }) {
  const uid = Number(userId);
  const num = normalizeE164(e164);

  if (!uid) throw Boom.badRequest('Invalid userId');
  if (!isE164(num)) throw Boom.badRequest('Invalid e164');

  // Optional: verify reservation exists and not expired
  const phone = await prisma.phoneNumber.findUnique({ where: { e164: num } });
  if (!phone) throw Boom.notFound('Not reserved');

  const reservation = await prisma.numberReservation.findFirst({
    where: { phoneNumberId: phone.id, userId: uid },
    orderBy: { createdAt: 'desc' },
  });
  if (!reservation || reservation.expiresAt < now()) {
    throw Boom.gone('Reservation expired');
  }

  // If user already has a number, you may want to release it first (your product decision)
  // For now: allow only one active leased number
  const existing = await prisma.phoneNumber.findFirst({
    where: { assignedUserId: uid, status: 'ASSIGNED' },
    select: { id: true, e164: true },
  });
  if (existing) {
    throw Boom.conflict('User already has an assigned number');
  }

  const api = await resolveTwilioProvider();

  // If this number is not actually owned in Twilio yet, purchase it now
  // (phone.source/phone.twilioSid can tell you if it’s provisioned)
  let twilioSid = phone.twilioSid || null;
  if (!twilioSid) {
    const purchased = await api.purchaseNumber({ phoneNumber: num });
    twilioSid = purchased?.sid || purchased?.order?.sid || null;
  }

  const assigned = await prisma.phoneNumber.update({
    where: { id: phone.id },
    data: {
      status: 'ASSIGNED',
      assignedUserId: uid,
      assignedAt: now(),
      lastOutboundAt: null,
      holdUntil: null,
      releaseAfter: null,
      twilioSid,
    },
  });

  return { ok: true, number: assigned };
}

/**
 * Release current user number back to pool:
 * - In your model, usually you *do not* release at Twilio (you keep ownership),
 *   you just mark it AVAILABLE again (or HOLD for cooling-off).
 */
export async function releaseUserNumber({ userId, holdDays = null }) {
  const uid = Number(userId);
  if (!uid) throw Boom.badRequest('Invalid userId');

  const phone = await prisma.phoneNumber.findFirst({
    where: { assignedUserId: uid, status: { in: ['ASSIGNED', 'HOLD'] } },
  });
  if (!phone) throw Boom.notFound('No number');

  const hold = typeof holdDays === 'number'
    ? new Date(Date.now() + holdDays * 24 * 60 * 60 * 1000)
    : null;

  const updated = await prisma.phoneNumber.update({
    where: { id: phone.id },
    data: {
      status: hold ? 'HOLD' : 'AVAILABLE',
      assignedUserId: hold ? uid : null,
      holdUntil: hold,
      assignedAt: hold ? phone.assignedAt : null,
      keepLocked: false,
      releaseAfter: null,
    },
  });

  return { ok: true, number: updated };
}

/**
 * Activity tracking:
 * - Call this on outbound + inbound so inactivity logic works.
 */
export async function recordNumberActivity({ e164, direction }) {
  const num = normalizeE164(e164);
  if (!isE164(num)) return { ok: false, reason: 'invalid-e164' };

  const data =
    direction === 'out'
      ? { lastOutboundAt: now() }
      : { /* inbound can also count */ updatedAt: now() };

  await prisma.phoneNumber.updateMany({
    where: { e164: num },
    data,
  });

  return { ok: true };
}
