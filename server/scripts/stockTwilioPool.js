#!/usr/bin/env node

/**
 * Buy Twilio numbers and add them to Chatforia's AVAILABLE reserve.
 *
 * Catalog only:
 *   node server/scripts/stockTwilioPool.js --list-countries
 *
 * Dry run:
 *   node server/scripts/stockTwilioPool.js \
 *     --country GB \
 *     --type auto \
 *     --limit 10
 *
 * Purchase:
 *   node server/scripts/stockTwilioPool.js \
 *     --country GB \
 *     --type auto \
 *     --limit 10 \
 *     --apply
 *
 * Optional:
 *   --require sms,voice
 *   --addressSid AD...
 *   --bundleSid BU...
 *   --identitySid RI...
 *
 * Country-specific regulatory configuration:
 *
 * TWILIO_NUMBER_REGULATORY_MAP_JSON='{
 *   "GB": {
 *     "addressSid": "AD...",
 *     "bundleSid": "BU..."
 *   },
 *   "DE:local": {
 *     "addressSid": "AD...",
 *     "bundleSid": "BU..."
 *   }
 * }'
 */

import 'dotenv/config';
import prisma from '../utils/prismaClient.js';
import twilioAdapter from '../lib/telco/twilio.js';

function arg(
  name,
  fallback = null
) {
  const index =
    process.argv.indexOf(`--${name}`);

  if (index === -1) {
    return fallback;
  }

  const value =
    process.argv[index + 1];

  if (
    !value ||
    value.startsWith('--')
  ) {
    return true;
  }

  return value;
}

function hasFlag(name) {
  return process.argv.includes(
    `--${name}`
  );
}

function toInt(
  value,
  fallback
) {
  const parsed =
    Number(value);

  return (
    Number.isFinite(parsed) &&
    parsed > 0
  )
    ? Math.floor(parsed)
    : fallback;
}

function parseBool(value) {
  if (value === true) {
    return true;
  }

  if (value == null) {
    return false;
  }

  return [
    '1',
    'true',
    'yes',
    'y',
    'on',
  ].includes(
    String(value).toLowerCase()
  );
}

function normalizeCountryIso2(value) {
  const normalized =
    String(value || '')
      .trim()
      .toUpperCase();

  if (!/^[A-Z]{2}$/.test(normalized)) {
    throw new Error(
      'country must be an ISO-3166-1 alpha-2 code such as US or GB'
    );
  }

  return normalized;
}

function normalizeType(value) {
  const normalized =
    String(value || 'auto')
      .trim()
      .toLowerCase();

  if (
    normalized === 'toll-free' ||
    normalized === 'toll_free'
  ) {
    return 'tollfree';
  }

  if (
    [
      'auto',
      'local',
      'mobile',
      'tollfree',
    ].includes(normalized)
  ) {
    return normalized;
  }

  throw new Error(
    'type must be auto, local, mobile, or tollfree'
  );
}

function normalizeCapabilities(value) {
  const supported =
    new Set([
      'sms',
      'voice',
      'mms',
    ]);

  const capabilities = [
    ...new Set(
      String(value || 'sms,voice')
        .split(',')
        .map((item) =>
          item
            .trim()
            .toLowerCase()
        )
        .filter(Boolean)
    ),
  ];

  if (!capabilities.length) {
    throw new Error(
      'At least one capability is required'
    );
  }

  for (
    const capability
    of capabilities
  ) {
    if (
      !supported.has(capability)
    ) {
      throw new Error(
        `Unsupported capability: ${capability}`
      );
    }
  }

  return capabilities;
}

function cleanE164(value) {
  return String(value || '').trim();
}

function inferAreaCode(
  e164,
  isoCountry
) {
  const country =
    String(isoCountry || '')
      .toUpperCase();

  const digits =
    String(e164 || '')
      .replace(/[^\d]/g, '');

  if (
    (
      country === 'US' ||
      country === 'CA'
    ) &&
    digits.length === 11 &&
    digits.startsWith('1')
  ) {
    return digits.slice(1, 4);
  }

  return null;
}

function normalizeCapabilitiesJson(value) {
  if (
    !value ||
    typeof value !== 'object'
  ) {
    return null;
  }

  return Object.fromEntries(
    Object.entries(value).map(
      ([key, enabled]) => [
        String(key).toLowerCase(),
        Boolean(enabled),
      ]
    )
  );
}

function normalizeCatalogType(value) {
  const normalized =
    String(value || '')
      .toLowerCase();

  if (
    normalized === 'toll_free' ||
    normalized === 'tollfree'
  ) {
    return 'tollfree';
  }

  if (
    normalized === 'local' ||
    normalized === 'mobile'
  ) {
    return normalized;
  }

  return null;
}

function supportedTypes(
  countryResource
) {
  return [
    ...new Set(
      Object.keys(
        countryResource
          ?.subresourceUris ||
        {}
      )
        .map(
          normalizeCatalogType
        )
        .filter(Boolean)
    ),
  ];
}

function resolveType(
  requested,
  supported
) {
  if (requested !== 'auto') {
    if (
      !supported.includes(requested)
    ) {
      throw new Error(
        `Twilio does not list ${requested} numbers for this account/country. ` +
        `Supported types: ${supported.join(', ') || 'none'}`
      );
    }

    return requested;
  }

  for (
    const preferred
    of [
      'local',
      'mobile',
      'tollfree',
    ]
  ) {
    if (
      supported.includes(preferred)
    ) {
      return preferred;
    }
  }

  throw new Error(
    'Twilio lists no purchasable number types for this country'
  );
}

function readRegulatoryMap() {
  const raw =
    process.env
      .TWILIO_NUMBER_REGULATORY_MAP_JSON;

  if (!raw) {
    return {};
  }

  try {
    const parsed =
      JSON.parse(raw);

    if (
      !parsed ||
      typeof parsed !== 'object' ||
      Array.isArray(parsed)
    ) {
      throw new Error(
        'expected a JSON object'
      );
    }

    return parsed;
  } catch (error) {
    throw new Error(
      `Invalid TWILIO_NUMBER_REGULATORY_MAP_JSON: ${error.message}`
    );
  }
}

function validateOptionalSid(
  value,
  prefix,
  label
) {
  const clean =
    typeof value === 'string'
      ? value.trim()
      : '';

  if (!clean) {
    return null;
  }

  const pattern =
    new RegExp(
      `^${prefix}[a-f0-9]{32}$`,
      'i'
    );

  if (!pattern.test(clean)) {
    throw new Error(
      `${label} must be a valid ${prefix} SID`
    );
  }

  return clean;
}

function resolveRegulatoryConfig(
  country,
  type
) {
  const map =
    readRegulatoryMap();

  const configured =
    map[`${country}:${type}`] ||
    map[country] ||
    {};

  return {
    addressSid:
      validateOptionalSid(
        arg(
          'addressSid',
          configured.addressSid ||
          null
        ),
        'AD',
        'addressSid'
      ),

    bundleSid:
      validateOptionalSid(
        arg(
          'bundleSid',
          configured.bundleSid ||
          null
        ),
        'BU',
        'bundleSid'
      ),

    identitySid:
      validateOptionalSid(
        arg(
          'identitySid',
          configured.identitySid ||
          null
        ),
        'RI',
        'identitySid'
      ),
  };
}

async function makeTwilioClient() {
  const sid =
    process.env
      .TWILIO_ACCOUNT_SID;

  const token =
    process.env
      .TWILIO_AUTH_TOKEN;

  if (!sid || !token) {
    throw new Error(
      'Missing TWILIO_ACCOUNT_SID or TWILIO_AUTH_TOKEN'
    );
  }

  const TwilioModule =
    await import('twilio');

  const Twilio =
    TwilioModule.default ||
    TwilioModule;

  const TwilioFunction =
    typeof Twilio === 'function'
      ? Twilio
      : (
          Twilio &&
          typeof Twilio.default ===
            'function'
        )
        ? Twilio.default
        : null;

  if (!TwilioFunction) {
    throw new Error(
      'Twilio client factory is not a function'
    );
  }

  return TwilioFunction(
    sid,
    token
  );
}

async function loadCountryCatalog(
  client
) {
  return client
    .availablePhoneNumbers
    .list({
      limit: 1000,
    });
}

function printCountryCatalog(
  countries
) {
  const rows =
    countries
      .map((country) => ({
        code:
          country.countryCode,

        country:
          country.country,

        types:
          supportedTypes(country)
            .join(', '),

        beta:
          Boolean(country.beta),
      }))
      .sort((first, second) =>
        String(first.country)
          .localeCompare(
            String(second.country)
          )
      );

  console.table(rows);

  console.log(
    `[stockTwilioPool] countries available to this account: ${rows.length}`
  );
}

async function safeUpsertPreservingAssignment(
  data
) {
  const existing =
    await prisma.phoneNumber
      .findUnique({
        where: {
          e164: data.e164,
        },
        select: {
          status: true,
        },
      });

  const protectedStatuses =
    new Set([
      'ASSIGNED',
      'HOLD',
      'RESERVED',
    ]);

  const shouldPreserve =
    existing &&
    protectedStatuses.has(
      existing.status
    );

  if (!existing) {
    return prisma.phoneNumber
      .create({
        data,
      });
  }

  return prisma.phoneNumber
    .update({
      where: {
        e164: data.e164,
      },

      data: {
        provider:
          data.provider,

        twilioSid:
          data.twilioSid ??
          null,

        isoCountry:
          data.isoCountry ??
          null,

        areaCode:
          data.areaCode ??
          null,

        locality:
          data.locality ??
          null,

        region:
          data.region ??
          null,

        capabilities:
          data.capabilities ??
          null,

        source:
          data.source,

        ...(
          shouldPreserve
            ? {}
            : {
                status:
                  'AVAILABLE',

                assignedUserId:
                  null,

                assignedAt:
                  null,

                holdUntil:
                  null,

                releaseAfter:
                  null,

                keepLocked:
                  false,

                forSale:
                  true,

                isLeasable:
                  true,

                isPurchasable:
                  true,
              }
        ),
      },
    });
}

function explainPurchaseError(
  error,
  context
) {
  const message =
    error?.message ||
    'purchase failed';

  const regulatory =
    /address|bundle|identity|regulat|compliance/i
      .test(message);

  return {
    e164:
      context.e164,

    country:
      context.country,

    type:
      context.type,

    message,

    code:
      error?.code,

    status:
      error?.status,

    moreInfo:
      error?.moreInfo,

    hint:
      regulatory
        ? 'Compliance required: configure addressSid, bundleSid, or identitySid for this country/type.'
        : undefined,
  };
}

async function main() {
  const client =
    await makeTwilioClient();

  const catalog =
    await loadCountryCatalog(
      client
    );

  if (
    hasFlag('list-countries')
  ) {
    printCountryCatalog(
      catalog
    );

    return;
  }

  const country =
    normalizeCountryIso2(
      arg(
        'country',
        'US'
      )
    );

  const requestedType =
    normalizeType(
      arg(
        'type',
        'auto'
      )
    );

  const countryResource =
    catalog.find(
      (entry) =>
        String(
          entry.countryCode
        ).toUpperCase() ===
        country
    );

  if (!countryResource) {
    throw new Error(
      `Twilio does not list ${country} for this account`
    );
  }

  const availableTypes =
    supportedTypes(
      countryResource
    );

  const type =
    resolveType(
      requestedType,
      availableTypes
    );

  const requiredCapabilities =
    normalizeCapabilities(
      arg(
        'require',
        'sms,voice'
      )
    );

  const areaCode =
    arg(
      'areaCode',
      null
    );

  const postalCode =
    arg(
      'postalCode',
      null
    );

  const limit =
    toInt(
      arg(
        'limit',
        10
      ),
      10
    );

  const apply =
    hasFlag('apply');

  const explicitDryRun =
    parseBool(
      arg(
        'dryRun',
        false
      )
    );

  const dryRun =
    !apply ||
    explicitDryRun;

  const regulatory =
    resolveRegulatoryConfig(
      country,
      type
    );

  console.log(
    '[stockTwilioPool] starting',
    {
      country,
      type,
      supportedTypes:
        availableTypes,
      requiredCapabilities,
      areaCode,
      postalCode,
      limit,
      dryRun,

      regulatory: {
        hasAddressSid:
          Boolean(
            regulatory.addressSid
          ),

        hasBundleSid:
          Boolean(
            regulatory.bundleSid
          ),

        hasIdentitySid:
          Boolean(
            regulatory.identitySid
          ),
      },

      hasTWILIO_WEBHOOK_BASE_URL:
        Boolean(
          process.env
            .TWILIO_WEBHOOK_BASE_URL
        ),
    }
  );

  if (!apply) {
    console.log(
      '⚠️ Dry run mode: use --apply to authorize purchases.'
    );
  }

  const { items } =
    await twilioAdapter
      .searchAvailable({
        country,

        areaCode:
          areaCode
            ? String(areaCode)
            : undefined,

        postalCode:
          postalCode
            ? String(postalCode)
            : undefined,

        type,

        limit:
          Math.max(
            limit * 3,
            limit
          ),

        requiredCapabilities,
      });

  const candidates =
    (items || [])
      .filter((number) =>
        requiredCapabilities.every(
          (capability) =>
            number.capabilities
              ?.[capability] ===
            true
        )
      )
      .map((number) => ({
        e164:
          cleanE164(
            number.e164 ||
            number.number
          ),

        locality:
          number.locality ||
          null,

        region:
          number.region ||
          null,

        capabilities:
          normalizeCapabilitiesJson(
            number.capabilities
          ),

        addressRequirements:
          number.addressRequirements ||
          null,
      }))
      .filter(
        (number) =>
          number.e164
      )
      .slice(
        0,
        limit
      );

  if (!candidates.length) {
    console.log(
      '[stockTwilioPool] no matching candidates found'
    );

    return;
  }

  console.log(
    '[stockTwilioPool] candidates',
    candidates
  );

  if (dryRun) {
    console.log(
      '[stockTwilioPool] dry run complete; no numbers purchased'
    );

    return;
  }

  const results = [];

  for (
    const candidate
    of candidates
  ) {
    try {
      if (
        candidate
          .addressRequirements &&
        candidate
          .addressRequirements !==
          'none' &&
        !regulatory.addressSid
      ) {
        throw new Error(
          `Compliance required: ${candidate.e164} has address requirement ` +
          `${candidate.addressRequirements}, but no addressSid is configured.`
        );
      }

      console.log(
        '[stockTwilioPool] purchasing',
        candidate.e164
      );

      const purchase =
        await twilioAdapter
          .purchaseNumber({
            phoneNumber:
              candidate.e164,

            ...regulatory,
          });

      const isoCountry =
        String(
          purchase?.isoCountry ||
          country
        ).toUpperCase();

      const capabilities =
        normalizeCapabilitiesJson(
          purchase?.capabilities ||
          candidate.capabilities
        );

      const row =
        await safeUpsertPreservingAssignment({
          e164:
            candidate.e164,

          provider:
            'twilio',

          twilioSid:
            purchase?.sid ||
            null,

          areaCode:
            inferAreaCode(
              candidate.e164,
              isoCountry
            ),

          isoCountry,

          capabilities,

          locality:
            purchase?.locality ||
            candidate.locality,

          region:
            purchase?.region ||
            candidate.region,

          status:
            'AVAILABLE',

          source:
            'PROVISIONED',

          vanity:
            false,

          keepLocked:
            false,

          forSale:
            true,

          isLeasable:
            true,

          isPurchasable:
            true,
        });

      results.push({
        ok: true,
        e164:
          candidate.e164,
        id:
          row.id,
      });

      console.log(
        '[stockTwilioPool] stocked',
        {
          e164:
            candidate.e164,

          id:
            row.id,

          twilioSid:
            purchase?.sid ||
            null,

          isoCountry,
          type,
          capabilities,
        }
      );
    } catch (error) {
      const details =
        explainPurchaseError(
          error,
          {
            e164:
              candidate.e164,

            country,
            type,
          }
        );

      console.error(
        '[stockTwilioPool] purchase failed',
        details
      );

      results.push({
        ok: false,

        e164:
          candidate.e164,

        error:
          details.message,
      });
    }
  }

  const okCount =
    results.filter(
      (result) =>
        result.ok
    ).length;

  const failCount =
    results.length -
    okCount;

  console.log(
    '[stockTwilioPool] done',
    {
      okCount,
      failCount,
    }
  );

  if (failCount) {
    process.exitCode = 1;
  }
}

main()
  .catch((error) => {
    console.error(
      '[stockTwilioPool] fatal',
      {
        message:
          error?.message ||
          String(error),

        stack:
          error?.stack,
      }
    );

    process.exitCode = 1;
  })
  .finally(async () => {
    try {
      await prisma
        .$disconnect();
    } catch {}
  });