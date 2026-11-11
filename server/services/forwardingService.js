import Boom from '@hapi/boom';
import prisma from '../utils/prismaClient.js';
import { normalizeForwardingTimeZone } from '../utils/forwardingQuietHours.js';

function normalizeE164(s) {
  return String(s || '').replace(/[^\d+]/g, '');
}
function isE164(s) {
  return /^\+?[1-9]\d{7,14}$/.test(normalizeE164(s));
}
function isEmail(s) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(s || ''));
}
function clampHour(v) {
  if (v == null) return null;
  const n = Number(v);
  if (!Number.isInteger(n) || n < 0 || n > 23 || v === '') throw Boom.badRequest('Quiet hours must be 0–23 or null');
  return n;
}

export async function getForwardingPrefs(userId) {
  const user = await prisma.user.findUnique({
    where: { id: Number(userId) },
    select: {
      forwardingEnabledSms: true,
      forwardSmsToPhone: true,
      forwardPhoneNumber: true,
      forwardSmsToEmail: true,
      forwardEmail: true,
      forwardingEnabledCalls: true,
      forwardToPhoneE164: true,
      forwardQuietHoursStart: true,
      forwardQuietHoursEnd: true,
      forwardQuietHoursTimeZone: true,
    },
  });
  if (!user) throw Boom.notFound('User not found');
  return user;
}

export async function updateForwardingPrefs(userId, patch) {
  const data = {};

  for (const key of ['forwardingEnabledSms', 'forwardSmsToPhone', 'forwardSmsToEmail', 'forwardingEnabledCalls']) {
    if (key in patch && typeof patch[key] !== 'boolean') {
      throw Boom.badRequest(`${key} must be a boolean`);
    }
  }

  if ('forwardingEnabledSms' in patch) data.forwardingEnabledSms = patch.forwardingEnabledSms;
  if ('forwardSmsToPhone' in patch) data.forwardSmsToPhone = patch.forwardSmsToPhone;
  if ('forwardSmsToEmail' in patch) data.forwardSmsToEmail = patch.forwardSmsToEmail;
  if ('forwardingEnabledCalls' in patch) data.forwardingEnabledCalls = patch.forwardingEnabledCalls;

  if ('forwardPhoneNumber' in patch) {
    const v = patch.forwardPhoneNumber ? normalizeE164(patch.forwardPhoneNumber) : '';
    if (data.forwardSmsToPhone ?? (await getForwardingPrefs(userId)).forwardSmsToPhone) {
      if (v && !isE164(v)) throw Boom.badRequest('Invalid phone for SMS forwarding');
    }
    data.forwardPhoneNumber = v;
  }

  if ('forwardEmail' in patch) {
    const v = patch.forwardEmail || '';
    if (data.forwardSmsToEmail ?? (await getForwardingPrefs(userId)).forwardSmsToEmail) {
      if (v && !isEmail(v)) throw Boom.badRequest('Invalid email for SMS forwarding');
    }
    data.forwardEmail = v;
  }

  if ('forwardToPhoneE164' in patch) {
    const v = patch.forwardToPhoneE164 ? normalizeE164(patch.forwardToPhoneE164) : '';
    if ((data.forwardingEnabledCalls ?? (await getForwardingPrefs(userId)).forwardingEnabledCalls) && !isE164(v)) {
      throw Boom.badRequest('Invalid phone for call forwarding');
    }
    data.forwardToPhoneE164 = v;
  }

  if ('forwardQuietHoursStart' in patch) data.forwardQuietHoursStart = clampHour(patch.forwardQuietHoursStart);
  if ('forwardQuietHoursEnd' in patch) data.forwardQuietHoursEnd = clampHour(patch.forwardQuietHoursEnd);
  if ('forwardQuietHoursTimeZone' in patch) {
    if (patch.forwardQuietHoursTimeZone == null) {
      data.forwardQuietHoursTimeZone = null;
    } else {
      try {
        data.forwardQuietHoursTimeZone = normalizeForwardingTimeZone(patch.forwardQuietHoursTimeZone);
      } catch {
        throw Boom.badRequest('Invalid IANA quiet-hours time zone');
      }
    }
  }

  // Require at least one destination if SMS forwarding enabled
  const after = { ...(await getForwardingPrefs(userId)), ...data };
  if (after.forwardingEnabledSms && !after.forwardSmsToPhone && !after.forwardSmsToEmail) {
    throw Boom.badRequest('Enable at least one SMS destination (phone or email).');
  }
  if (after.forwardingEnabledSms && after.forwardSmsToPhone && !isE164(after.forwardPhoneNumber || '')) {
    throw Boom.badRequest('Missing/invalid forwardPhoneNumber');
  }
  if (after.forwardingEnabledSms && after.forwardSmsToEmail && !isEmail(after.forwardEmail)) {
    throw Boom.badRequest('Missing/invalid forwardEmail');
  }
  if (after.forwardingEnabledCalls && !isE164(after.forwardToPhoneE164 || '')) {
    throw Boom.badRequest('Missing/invalid forwardToPhoneE164');
  }
  if ((after.forwardQuietHoursStart == null) !== (after.forwardQuietHoursEnd == null)) {
    throw Boom.badRequest('Set both quiet hours or clear both');
  }
  if (after.forwardQuietHoursStart != null && after.forwardQuietHoursStart === after.forwardQuietHoursEnd) {
    throw Boom.badRequest('Quiet hours start and end must differ');
  }
  if ('forwardQuietHoursTimeZone' in patch && after.forwardQuietHoursStart != null &&
      after.forwardQuietHoursTimeZone == null) {
    throw Boom.badRequest('Choose an IANA time zone for quiet hours');
  }

  const updated = await prisma.user.update({
    where: { id: Number(userId) },
    data,
    select: {
      forwardingEnabledSms: true,
      forwardSmsToPhone: true,
      forwardPhoneNumber: true,
      forwardSmsToEmail: true,
      forwardEmail: true,
      forwardingEnabledCalls: true,
      forwardToPhoneE164: true,
      forwardQuietHoursStart: true,
      forwardQuietHoursEnd: true,
      forwardQuietHoursTimeZone: true,
    },
  });

  return updated;
}
