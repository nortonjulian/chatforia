import 'dotenv/config';
import Twilio from 'twilio';
import prisma from '../utils/prismaClient.js';

/**
 * Sync Twilio-owned inventory into DB
 *
 * Defaults to DRY RUN (prints what it would do).
 *
 * Usage:
 *   node server/scripts/syncTwilioInventory.js
 *   node server/scripts/syncTwilioInventory.js --apply
 *   node server/scripts/syncTwilioInventory.js --apply --mark-missing-released
 *   node server/scripts/syncTwilioInventory.js --apply --provider twilio
 */

const argv = process.argv.slice(2);
const has = (flag) => argv.includes(flag);
const readArg = (key, fallback = null) => {
  const i = argv.indexOf(key);
  if (i === -1) return fallback;
  return argv[i + 1] ?? fallback;
};

const APPLY = has('--apply');
const MARK_MISSING_RELEASED = has('--mark-missing-released');
const PROVIDER = readArg('--provider', 'twilio');

function getTwilioClient() {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;

  if (!sid || !token) {
    throw new Error(
      'Missing TWILIO_ACCOUNT_SID or TWILIO_AUTH_TOKEN in env. Cannot sync.'
    );
  }

  const TwilioFn =
    typeof Twilio === 'function'
      ? Twilio
      : Twilio && typeof Twilio.default === 'function'
      ? Twilio.default
      : null;

  if (!TwilioFn) throw new Error('Twilio client factory is not a function');

  return TwilioFn(sid, token);
}

function toIso2(v) {
  if (!v) return null;
  const s = String(v).trim().toUpperCase();
  return s.length === 2 ? s : null;
}

/**
 * Your Twilio SDK payload doesn't include isoCountry for incomingPhoneNumbers,
 * so we infer country from E.164 as a safe fallback.
 *
 * NOTE: +1 could be US/CA; for now returning 'US' is fine for your pool filtering
 * and areaCode parsing. If you later need strict US vs CA, use libphonenumber.
 */
function inferIsoCountryFromE164(e164) {
  if (!e164) return null;
  const digits = String(e164).replace(/[^\d]/g, '');
  if (digits.startsWith('1') && digits.length === 11) return 'US';
  return null;
}

function parseAreaCode(e164, iso2) {
  // Only attempt US/CA (+1NPA...)
  if (!e164) return null;
  if (iso2 !== 'US' && iso2 !== 'CA') return null;

  const digits = String(e164).replace(/[^\d]/g, '');
  // +1XXXXXXXXXX => digits length 11 starting with 1
  if (digits.length === 11 && digits.startsWith('1')) return digits.slice(1, 4);

  return null;
}

function twilioCapsToJson(capabilities) {
  if (!capabilities || typeof capabilities !== 'object') return null;
  const obj = {};
  for (const [k, v] of Object.entries(capabilities)) {
    obj[String(k).toLowerCase()] = Boolean(v);
  }
  return obj;
}

async function listAllIncomingNumbers(client) {
  const all = [];
  let pageToken = undefined;

  for (let i = 0; i < 2000; i++) {
    const page = await client.incomingPhoneNumbers.page({
      pageSize: 50,
      pageToken,
    });

    all.push(...(page.instances || []));

    if (!page.nextPageUrl || !page.nextPageToken) break;
    pageToken = page.nextPageToken;
  }

  return all;
}

async function main() {
  console.log('[syncTwilioInventory] start', {
    APPLY,
    MARK_MISSING_RELEASED,
    PROVIDER,
  });

  const client = getTwilioClient();
  const twilioNums = await listAllIncomingNumbers(client);

  console.log('[syncTwilioInventory] twilio numbers', {
    count: twilioNums.length,
  });

  const twilioSet = new Set();

  let created = 0;
  let updated = 0;
  let unchanged = 0;

  for (const n of twilioNums) {
    const e164 = n.phoneNumber;
    if (!e164) continue;

    // Optional debug (kept minimal)
    // if (e164 === '+17609249652') console.log('[debug 760]', Object.keys(n));

    twilioSet.add(e164);

    // Twilio payload in your environment doesn't include isoCountry, so infer it.
    const iso2 =
      toIso2(
        n.isoCountry ??
          n.iso_country ??
          n.iso_country_code ??
          n.countryCode ??
          n.country_code
      ) ?? inferIsoCountryFromE164(e164);

    const capsJson = twilioCapsToJson(n.capabilities);
    const areaCode = parseAreaCode(e164, iso2);

    const existing = await prisma.phoneNumber.findUnique({
      where: { e164 },
      select: {
        id: true,
        twilioSid: true,
        isoCountry: true,
        capabilities: true,
        provider: true,
        areaCode: true,
        status: true,
        assignedUserId: true,
        keepLocked: true,
        source: true,
      },
    });

    if (!existing) {
      created++;

      const data = {
        e164,
        provider: PROVIDER,
        twilioSid: n.sid || null,
        isoCountry: iso2,
        capabilities: capsJson,
        areaCode,
        status: 'AVAILABLE',
        source: 'PROVISIONED',
      };

      if (!APPLY) {
        console.log('[DRY] create', data);
      } else {
        await prisma.phoneNumber.create({ data });
      }
      continue;
    }

    // Inventory sync only (do not override lifecycle/assignment)
    const next = {
      provider: PROVIDER,
      twilioSid: n.sid || existing.twilioSid || null,
      isoCountry: iso2 ?? existing.isoCountry ?? null,
      capabilities: capsJson ?? existing.capabilities ?? null,
      areaCode: areaCode ?? existing.areaCode ?? null,
      source: existing.source || 'PROVISIONED',
    };

    const changed =
      (next.provider ?? null) !== (existing.provider ?? null) ||
      (next.twilioSid ?? null) !== (existing.twilioSid ?? null) ||
      (next.isoCountry ?? null) !== (existing.isoCountry ?? null) ||
      JSON.stringify(next.capabilities ?? null) !==
        JSON.stringify(existing.capabilities ?? null) ||
      (next.areaCode ?? null) !== (existing.areaCode ?? null) ||
      (next.source ?? null) !== (existing.source ?? null);

    if (!changed) {
      unchanged++;
      continue;
    }

    updated++;

    if (!APPLY) {
      console.log('[DRY] update', { e164, id: existing.id, next });
    } else {
      await prisma.phoneNumber.update({
        where: { id: existing.id },
        data: next,
      });
    }
  }

  // Optionally mark DB numbers missing from Twilio as RELEASED
  let missingReleased = 0;

  if (MARK_MISSING_RELEASED) {
    const dbNumbers = await prisma.phoneNumber.findMany({
      where: { provider: PROVIDER },
      select: { id: true, e164: true, status: true, assignedUserId: true },
    });

    for (const db of dbNumbers) {
      if (!db.e164) continue;
      if (twilioSet.has(db.e164)) continue;

      if (db.assignedUserId) continue;
      if (db.status !== 'AVAILABLE' && db.status !== 'HOLD') continue;

      missingReleased++;

      if (!APPLY) {
        console.log('[DRY] mark missing as RELEASED', {
          e164: db.e164,
          id: db.id,
        });
      } else {
        await prisma.phoneNumber.update({
          where: { id: db.id },
          data: {
            status: 'RELEASED',
            twilioSid: null,
            holdUntil: null,
            releaseAfter: null,
          },
        });
      }
    }
  }

  console.log('[syncTwilioInventory] done', {
    created,
    updated,
    unchanged,
    missingReleased,
    dryRun: !APPLY,
  });
}

main()
  .catch((e) => {
    console.error('[syncTwilioInventory] error', {
      message: e?.message,
      stack: e?.stack,
    });
    process.exitCode = 1;
  })
  .finally(async () => {
    try {
      await prisma.$disconnect();
    } catch {}
  });
