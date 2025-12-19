#!/usr/bin/env node
/**
 * Stock Chatforia inventory by BUYING numbers from Twilio, then upserting into Prisma.
 *
 * Examples:
 *   node server/scripts/stockTwilioPool.js --country US --areaCode 415 --limit 10
 *   node server/scripts/stockTwilioPool.js --country US --areaCode 303 --limit 5 --type local
 *   node server/scripts/stockTwilioPool.js --country US --areaCode 212 --limit 3 --dryRun
 *
 * Notes:
 * - This purchases numbers on your Twilio account (costs money).
 * - It wires inbound webhooks via your existing purchaseNumber() logic in lib/telco/twilio.js
 */

import 'dotenv/config';
import prisma from '../utils/prismaClient.js';
import twilioAdapter from '../lib/telco/twilio.js';

function arg(name, fallback = null) {
  const idx = process.argv.indexOf(`--${name}`);
  if (idx === -1) return fallback;
  const v = process.argv[idx + 1];
  if (!v || v.startsWith('--')) return true; // flag
  return v;
}

function toInt(v, fallback) {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function parseBool(v) {
  if (v === true) return true;
  if (v == null) return false;
  return ['1', 'true', 'yes', 'y', 'on'].includes(String(v).toLowerCase());
}

function normalizeCountryIso2(v) {
  const s = String(v || '').trim().toUpperCase();
  if (!s || s.length !== 2) throw new Error('country must be ISO2 like "US"');
  return s;
}

function cleanE164(v) {
  return String(v || '').trim();
}

function inferAreaCode(e164, isoCountry) {
  // Good enough for US/CA: +1 NPA-NXX-XXXX => areaCode = NPA
  const cc = String(isoCountry || '').toUpperCase();
  const s = String(e164 || '');
  if ((cc === 'US' || cc === 'CA') && s.startsWith('+1')) {
    const digits = s.replace(/[^\d]/g, '');
    if (digits.length === 11) return digits.slice(1, 4);
  }
  return null;
}

function normalizeCapabilitiesJson(capabilitiesLike) {
  // Twilio returns { sms: true, mms: true, voice: true }
  // Store exactly that (or null if unknown)
  if (!capabilitiesLike || typeof capabilitiesLike !== 'object') return null;

  const out = {};
  for (const [k, v] of Object.entries(capabilitiesLike)) {
    out[String(k).toLowerCase()] = !!v;
  }
  return out;
}

async function safeUpsertPreservingAssignment(data) {
  const existing = await prisma.phoneNumber.findUnique({
    where: { e164: data.e164 },
    select: { status: true },
  });

  // If already assigned/held/reserved, keep its status/assignment
  const protectedStatuses = ['ASSIGNED', 'HOLD', 'RESERVED'];
  const shouldPreserve = existing && protectedStatuses.includes(existing.status);

  if (!existing) {
    return prisma.phoneNumber.create({ data });
  }

  return prisma.phoneNumber.update({
    where: { e164: data.e164 },
    data: {
      provider: data.provider,
      twilioSid: data.twilioSid ?? null,
      isoCountry: data.isoCountry ?? null,
      areaCode: data.areaCode ?? null,
      capabilities: data.capabilities ?? null, // Json?
      source: data.source,
      ...(shouldPreserve
        ? {}
        : {
            status: 'AVAILABLE',
            assignedUserId: null,
            assignedAt: null,
            holdUntil: null,
            releaseAfter: null,
            keepLocked: false,
          }),
    },
  });
}

async function makeTwilioClient() {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  if (!sid || !token) throw new Error('Missing TWILIO_ACCOUNT_SID or TWILIO_AUTH_TOKEN');

  const TwilioMod = await import('twilio');
  const Twilio = TwilioMod.default || TwilioMod;

  const TwilioFn =
    typeof Twilio === 'function'
      ? Twilio
      : (Twilio && typeof Twilio.default === 'function' ? Twilio.default : null);

  if (!TwilioFn) throw new Error('Twilio client factory is not a function');

  return TwilioFn(sid, token);
}

async function main() {
  const country = normalizeCountryIso2(arg('country', 'US'));
  const areaCode = arg('areaCode', null);
  const type = String(arg('type', 'local')); // local|tollfree|mobile
  const limit = toInt(arg('limit', 10), 10);
  const dryRun = parseBool(arg('dryRun', false));

  console.log('[stockTwilioPool] starting', {
    country,
    areaCode,
    type,
    limit,
    dryRun,
    hasTWILIO_WEBHOOK_BASE_URL: !!process.env.TWILIO_WEBHOOK_BASE_URL,
  });

  // 1) Find purchasable candidates via Twilio search
  const { items } = await twilioAdapter.searchAvailable({
    country,
    areaCode: areaCode ? String(areaCode) : undefined,
    type,
    limit: Math.max(limit * 2, limit),
  });

  if (!items?.length) {
    console.log('[stockTwilioPool] no candidates found from Twilio search');
    process.exit(0);
  }

  const candidates = items
    .map((n) => cleanE164(n.e164 || n.number))
    .filter(Boolean)
    .slice(0, limit);

  console.log('[stockTwilioPool] candidates', candidates);

  if (dryRun) {
    console.log('[stockTwilioPool] dryRun=true; exiting without purchases');
    process.exit(0);
  }

  const client = await makeTwilioClient();

  // 2) Purchase + upsert each
  const results = [];
  for (const phoneNumber of candidates) {
    try {
      console.log('[stockTwilioPool] purchasing', phoneNumber);

      // Purchase and wire webhooks using your adapter
      const purchase = await twilioAdapter.purchaseNumber({ phoneNumber });

      const twilioSid = purchase?.sid || null;

      // 3) Enrich from Twilio incoming number record
      let isoCountry = country;
      let capabilitiesJson = null;

      try {
        if (twilioSid) {
          const rec = await client.incomingPhoneNumbers(twilioSid).fetch();
          isoCountry = (rec?.isoCountry || isoCountry || '').toUpperCase();
          capabilitiesJson = normalizeCapabilitiesJson(rec?.capabilities);
        } else {
          // fallback: lookup by phoneNumber if sid not returned (rare)
          const list = await client.incomingPhoneNumbers.list({ phoneNumber, limit: 1 });
          const rec = list?.[0];
          if (rec) {
            isoCountry = (rec?.isoCountry || isoCountry || '').toUpperCase();
            capabilitiesJson = normalizeCapabilitiesJson(rec?.capabilities);
          }
        }
      } catch (e) {
        console.warn('[stockTwilioPool] enrich warning (continuing):', e?.message || e);
      }

      const area = inferAreaCode(phoneNumber, isoCountry);

      // 4) Upsert into DB as AVAILABLE inventory
      const row = await safeUpsertPreservingAssignment({
        e164: phoneNumber,
        provider: 'twilio',
        twilioSid,
        areaCode: area,
        isoCountry: isoCountry || null,
        capabilities: capabilitiesJson, // Json?
        status: 'AVAILABLE',
        source: 'PROVISIONED',
        vanity: false,
        keepLocked: false,
      });

      results.push({ ok: true, e164: phoneNumber, id: row.id, twilioSid });
      console.log('[stockTwilioPool] stocked', {
        e164: phoneNumber,
        id: row.id,
        twilioSid,
        isoCountry,
        areaCode: area,
        capabilities: capabilitiesJson,
      });
    } catch (err) {
      console.error('[stockTwilioPool] purchase failed', {
        e164: phoneNumber,
        message: err?.message,
        code: err?.code,
        status: err?.status,
        moreInfo: err?.moreInfo,
      });
      results.push({ ok: false, e164: phoneNumber, error: err?.message || 'purchase failed' });
    }
  }

  const okCount = results.filter((r) => r.ok).length;
  const failCount = results.length - okCount;

  console.log('[stockTwilioPool] done', { okCount, failCount });

  await prisma.$disconnect();
  process.exit(failCount ? 1 : 0);
}

main().catch(async (e) => {
  console.error('[stockTwilioPool] fatal', e);
  try {
    await prisma.$disconnect();
  } catch {}
  process.exit(1);
});
