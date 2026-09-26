import express from 'express';
import prisma from '../utils/prismaClient.js';
import telco, {
  getProvider,
  providerName as defaultProviderName,
} from '../lib/telco/index.js';
import { requireAuth } from '../middleware/auth.js';
import { requirePremium } from '../middleware/requirePremium.js';
import { regulatoryDocumentUploadMemory } from '../middleware/uploads.js';
import { normalizeE164, isE164 } from '../utils/phone.js';
import {
  evaluateNumberRegulatoryCompliance,
  initializeNumberRegulatoryVerification,
  getRegulatorySupportingDocumentFieldRequirements,
  provisionRegulatorySupportingDocument,
  assembleRegulatoryBundle,
  submitNumberRegulatoryBundle,
} from '../services/numberRegulatoryService.js';

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
function getPolicy(plan = 'FREE') {
  const inactivityDays = Number(process.env.NUMBER_INACTIVITY_DAYS) || 30;
  const holdDays = Number(process.env.NUMBER_HOLD_DAYS) || 14;

  if (String(plan || 'FREE').toUpperCase() === 'FREE') {
    return {
      mode: 'AUTO_RECYCLE',
      inactivityDays,
      holdDays,
      description: 'Numbers may be recycled after inactivity on the Free plan.',
    };
  }

  return {
    mode: 'PROTECTED',
    inactivityDays: null,
    holdDays: null,
    description:
      'Your number is protected from automatic recycling while your subscription is active.',
  };
}

/* ---------------------------
 * Helpers for filtering pool
 * -------------------------- */

function normalizeCountryIso2(v) {
  if (!v) return null;
  const s = String(v).trim().toUpperCase();
  if (s.length !== 2) return null;
  return s;
}

function parseCapsParam(capsLike) {
  // supports: caps=sms,voice OR caps[]=sms&caps[]=voice
  if (!capsLike) return [];
  if (Array.isArray(capsLike)) return capsLike.map(String);
  return String(capsLike)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

function normalizeCap(c) {
  const v = String(c || '').trim().toLowerCase();
  if (v === 'sms' || v === 'voice' || v === 'mms') return v;
  if (v === 'both') return 'both';
  return null;
}

function toCapArray(caps) {
  if (!caps) return [];
  if (Array.isArray(caps)) return caps;
  if (typeof caps === 'string') {
    return caps.split(',').map((s) => s.trim()).filter(Boolean);
  }
  return [];
}

function parseBoolean(v) {
  if (v === true || v === false) return v;
  if (v == null) return null;
  const s = String(v).trim().toLowerCase();
  if (['1', 'true', 'yes', 'y', 'on'].includes(s)) return true;
  if (['0', 'false', 'no', 'n', 'off'].includes(s)) return false;
  return null;
}

const US_TOLL_FREE_NPAS = ['800', '833', '844', '855', '866', '877', '888'];

function buildPoolWhere({
  areaCode,
  country,
  capability,
  caps,
  includeTollFree = false,
  forSale = null, // null = no filter; true = sellable-only; false = non-sellable-only
}) {
  const where = {
    status: 'AVAILABLE',
    provider: 'twilio',
  };

  if (areaCode) where.areaCode = String(areaCode);
  if (country) where.isoCountry = country;

  // Apply sellable filter (premium inventory)
  // Requires Prisma model: phoneNumber.forSale Boolean @default(false)
  if (forSale === true) where.isPurchasable = true;
  if (forSale === false) where.isLeasable = true;

  // Normalize capability input
  const cap = normalizeCap(capability);
  const capList = toCapArray(caps).map(normalizeCap).filter(Boolean);

  const needs = [];
  if (cap && cap !== 'both') needs.push(cap);
  if (cap === 'both') needs.push('sms', 'voice');

  for (const c of capList) {
    if (c === 'both') needs.push('sms', 'voice');
    else needs.push(c);
  }

  const uniq = Array.from(new Set(needs));

  // JSON-object capabilities: { sms:true, voice:true, ... }
  if (uniq.length) {
    where.AND = (where.AND || []).concat(
      uniq.map((c) => ({
        capabilities: { path: [c], equals: true },
      }))
    );
  }

  // Default: exclude toll-free for US pools
  if (!includeTollFree) {
    const iso = (country || '').toUpperCase();
    if (iso === 'US') {
      where.AND = (where.AND || []).concat([
        { NOT: [{ areaCode: { in: US_TOLL_FREE_NPAS } }] },
      ]);
    }
  }

  return where;
}

/**
 * GET /numbers/my
 * Current assignment + policy
 *
 * NOTE: keep response stable for your PhoneNumberManager.
 */
router.get('/my', requireAuth, async (req, res) => {
  const [num, user] = await Promise.all([
    prisma.phoneNumber.findFirst({
      where: {
        assignedUserId: req.user.id,
        status: { in: ['ASSIGNED', 'HOLD'] },
      },
      orderBy: { id: 'asc' },
    }),
    prisma.user.findUnique({
      where: { id: req.user.id },
      select: { plan: true, subscriptionStatus: true },
    }),
  ]);

  const plan = user?.plan || 'FREE';

  res.json({ number: num, policy: getPolicy(plan) });
});

/**
 * GET /numbers/available?areaCode=303&limit=20&country=US&type=local
 * Twilio *live* search (admin/internal tooling).
 * This should NOT be used by the normal user UI.
 *
 * Gate it behind an env flag so it's effectively "admin-only" without wiring roles yet.
 */
router.get('/available', requireAuth, async (req, res) => {
  const enabled = parseBoolean(process.env.ENABLE_TWILIO_LIVE_SEARCH) === true;
  if (!enabled) {
    return res.status(403).json({
      error: 'Twilio live search is disabled on this environment.',
      hint: 'Set ENABLE_TWILIO_LIVE_SEARCH=true to enable internal tooling.',
    });
  }

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
      note: 'Internal/admin endpoint: Twilio-available numbers to BUY (live search).',
    });
  } catch (err) {
    console.error('Available search failed:', err);
    res.status(502).json({ error: 'Number search failed' });
  }
});

/**
 * GET /numbers/regulatory-requirements
 * Discover Twilio regulatory requirements before number assignment.
 *
 * Query:
 * - country: required ISO-2 country code
 * - numberType: local | mobile | national | toll-free
 * - endUserType: individual | business
 */
router.get('/regulatory-requirements', requireAuth, async (req, res) => {
  const country = normalizeCountryIso2(req.query.country);

  if (!country) {
    return res.status(400).json({
      error: 'country must be a 2-letter ISO country code',
    });
  }

  const numberType = String(
    req.query.numberType || 'local'
  )
    .trim()
    .toLowerCase();

  const endUserType = String(
    req.query.endUserType || 'individual'
  )
    .trim()
    .toLowerCase();

  try {
    const api = await resolveTwilioProvider();

    if (!api || typeof api.getRegulations !== 'function') {
      return res.status(503).json({
        error: 'Regulatory compliance provider unavailable',
      });
    }

    const regulations = await api.getRegulations({
      country,
      numberType,
      endUserType,
      includeConstraints: true,
    });

    return res.json({
      country,
      numberType,
      endUserType,
      requiresRegulatoryCompliance: regulations.length > 0,
      regulations,
    });
  } catch (err) {
    console.error('Regulatory requirements lookup failed:', err);

    const message = String(err?.message || '');

    if (
      message.includes('Unsupported regulatory number type') ||
      message.includes('endUserType must be')
    ) {
      return res.status(400).json({
        error: message,
      });
    }

    return res.status(502).json({
      error: 'Regulatory requirements lookup failed',
    });
  }
});

/**
 * GET /numbers/pool?areaCode=303&country=US&capability=sms&caps=sms,voice&limit=20&forSale=true
 * Chatforia-owned inventory pool (DB).
 *
 * - forSale=true => "buyable premium pool" (sellable inventory)
 * - forSale=false => "free pool" only (non-sellable)
 * - omit forSale => no sellable filter (useful for internal/admin screens)
 */
router.get('/pool', requireAuth, async (req, res) => {
  const areaCode = req.query.areaCode ? String(req.query.areaCode) : undefined;
  const country = normalizeCountryIso2(req.query.country) || 'US';
  const limit = req.query.limit ? Number(req.query.limit) : 20;

  // Accept both "capability" and "caps"
  const capability = req.query.capability ? String(req.query.capability) : null;
  const caps = parseCapsParam(req.query.caps);

  const forSale = parseBoolean(req.query.forSale); // true/false/null

  const where = buildPoolWhere({ areaCode, country, capability, caps, forSale });

  const items = await prisma.phoneNumber.findMany({
    where,
    orderBy: [{ vanity: 'desc' }, { id: 'asc' }],
    take: limit,
    select: {
      id: true,
      e164: true,
      areaCode: true,
      vanity: true,
      provider: true,
      source: true,
      status: true,
      isoCountry: true,
      locality: true,
      region: true,
      capabilities: true, 
      forSale: true, 
      isLeasable: true,
      isPurchasable: true,     
    },
  });

  res.json({
    numbers: items,
    provider: 'twilio',
    filters: {
      areaCode: areaCode || null,
      isoCountry: country || null,
      capability,
      caps,
      forSale,
    },
  });
});

/**
 * GET /numbers/pool/buyable
 * Convenience endpoint for "premium inventory" list.
 * Equivalent to: /numbers/pool?forSale=true
 */
router.get('/pool/buyable', requireAuth, async (req, res) => {
  // Just forward into the /pool handler behavior by reusing the same logic:
  const areaCode = req.query.areaCode ? String(req.query.areaCode) : undefined;
  const country = normalizeCountryIso2(req.query.country) || 'US';
  const limit = req.query.limit ? Number(req.query.limit) : 20;
  const capability = req.query.capability ? String(req.query.capability) : null;
  const caps = parseCapsParam(req.query.caps);

  const where = buildPoolWhere({
    areaCode,
    country,
    capability,
    caps,
    forSale: true,
  });

  const items = await prisma.phoneNumber.findMany({
    where,
    orderBy: [{ vanity: 'desc' }, { id: 'asc' }],
    take: limit,
    select: {
      id: true,
      e164: true,
      areaCode: true,
      vanity: true,
      provider: true,
      source: true,
      status: true,
      isoCountry: true,
      capabilities: true,
      forSale: true,
    },
  });

  res.json({
    numbers: items,
    provider: 'twilio',
    filters: { areaCode: areaCode || null, isoCountry: country || null, capability, caps, forSale: true },
  });
});

/**
 * POST /numbers/lease
 * Lease (assign) a number from Chatforia-owned pool to this user.
 *
 * NEW:
 * - purchaseIntent: true => treat as "BUY" assignment from sellable inventory
 *   (server should ALSO charge user elsewhere in your billing flow)
 *
 * Supports TWO modes:
 *  A) Explicit number: { e164: "+1760..." }
 *  B) Filter-based: { areaCode?, country?, capability?, caps? }
 */
function runRegulatoryDocumentUpload(
  req,
  res,
  next
) {
  regulatoryDocumentUploadMemory(
    req,
    res,
    (error) => {
      if (!error) {
        return next();
      }

      if (error?.code === 'LIMIT_FILE_SIZE') {
        return res.status(413).json({
          error: 'REGULATORY_DOCUMENT_TOO_LARGE',
        });
      }

      if (
        error?.message ===
        'UNSUPPORTED_REGULATORY_DOCUMENT_TYPE'
      ) {
        return res.status(400).json({
          error:
            'UNSUPPORTED_REGULATORY_DOCUMENT_TYPE',
        });
      }

      if (
        error?.message ===
        'INVALID_REGULATORY_DOCUMENT_EXTENSION'
      ) {
        return res.status(400).json({
          error:
            'INVALID_REGULATORY_DOCUMENT_EXTENSION',
        });
      }

      return res.status(400).json({
        error: 'INVALID_REGULATORY_DOCUMENT_UPLOAD',
      });
    }
  );
}

function parseRegulatoryDocumentAttributes(value) {
  if (
    value === undefined ||
    value === null ||
    value === ''
  ) {
    return {
      valid: true,
      attributes: undefined,
    };
  }

  if (
    typeof value === 'object' &&
    !Array.isArray(value)
  ) {
    return {
      valid: true,
      attributes: value,
    };
  }

  if (typeof value !== 'string') {
    return {
      valid: false,
      attributes: undefined,
    };
  }

  try {
    const parsed = JSON.parse(value);

    if (
      !parsed ||
      typeof parsed !== 'object' ||
      Array.isArray(parsed)
    ) {
      return {
        valid: false,
        attributes: undefined,
      };
    }

    return {
      valid: true,
      attributes: parsed,
    };
  } catch {
    return {
      valid: false,
      attributes: undefined,
    };
  }
}

router.post(
  '/regulatory/initialize',
  requireAuth,
  async (req, res) => {
    const userId = req.user.id;

    const e164 = String(
      req.body?.e164 || ''
    ).trim();

    if (!e164) {
      return res.status(400).json({
        error: 'e164 required',
      });
    }

    const candidate =
      await prisma.phoneNumber.findFirst({
        where: {
          e164,
          status: 'AVAILABLE',
          isLeasable: true,
        },
      });

    if (!candidate) {
      return res.status(404).json({
        error: 'Number not available',
      });
    }

    if (!candidate.regulatoryNumberType) {
      return res.status(409).json({
        error: 'BLOCKED_UNKNOWN_NUMBER_TYPE',
        decision: 'BLOCKED_UNKNOWN_NUMBER_TYPE',
      });
    }

    try {
      const regulatoryReservation =
        await prisma.$transaction(async (tx) => {
          await tx.$executeRaw`
            SELECT pg_advisory_xact_lock(
              CAST(${candidate.id} AS integer),
              CAST(1 AS integer)
            )
          `;

          const now = new Date();

          const activeReservation =
            await tx.numberReservation.findFirst({
              where: {
                phoneNumberId: candidate.id,
                purpose:
                  'REGULATORY_VERIFICATION',
                expiresAt: {
                  gt: now,
                },
              },
              orderBy: {
                createdAt: 'desc',
              },
            });

          if (
            activeReservation &&
            activeReservation.userId !== userId
          ) {
            return {
              acquired: false,
              reservation: activeReservation,
            };
          }

          const ttlMinutes = Math.max(
            1,
            Number(
              process.env
                .REGULATORY_RESERVATION_MINUTES
            ) || 60
          );

          const expiresAt = new Date(
            now.getTime() +
              ttlMinutes * 60 * 1000
          );

          if (activeReservation) {
            const reservation =
              await tx.numberReservation.update({
                where: {
                  id: activeReservation.id,
                },
                data: {
                  expiresAt,
                },
              });

            return {
              acquired: true,
              reservation,
            };
          }

          const reservation =
            await tx.numberReservation.create({
              data: {
                phoneNumberId: candidate.id,
                userId,
                purpose:
                  'REGULATORY_VERIFICATION',
                expiresAt,
              },
            });

          return {
            acquired: true,
            reservation,
          };
        });

      if (!regulatoryReservation.acquired) {
        return res.status(409).json({
          error: 'NUMBER_REGULATORY_RESERVED',
          decision: 'NUMBER_REGULATORY_RESERVED',
        });
      }

      const options = {
        userId,
        candidate,
        endUserType: 'individual',
      };

      if (
        Object.prototype.hasOwnProperty.call(
          req.body || {},
          'endUserAttributes'
        )
      ) {
        options.endUserAttributes =
          req.body.endUserAttributes;
      }

      const result =
        await initializeNumberRegulatoryVerification(
          options
        );

      if (!result.initialized) {
        return res.status(409).json(result);
      }

      return res.status(200).json(result);
    } catch {
      return res.status(502).json({
        error:
          'Regulatory verification initialization failed',
      });
    }
  }
);

router.post(
  '/regulatory/document-requirements',
  requireAuth,
  async (req, res) => {
    const userId = req.user.id;

    const e164 = String(
      req.body?.e164 || ''
    ).trim();

    const requirementName = String(
      req.body?.requirementName || ''
    ).trim();

    const documentType = String(
      req.body?.documentType || ''
    ).trim();

    if (!e164) {
      return res.status(400).json({
        error: 'e164 required',
      });
    }

    if (!requirementName) {
      return res.status(400).json({
        error: 'requirementName required',
      });
    }

    if (!documentType) {
      return res.status(400).json({
        error: 'documentType required',
      });
    }

    const candidate =
      await prisma.phoneNumber.findFirst({
        where: {
          e164,
          status: 'AVAILABLE',
          isLeasable: true,
        },
      });

    if (!candidate) {
      return res.status(404).json({
        error: 'Number not available',
      });
    }

    if (!candidate.regulatoryNumberType) {
      return res.status(409).json({
        error: 'BLOCKED_UNKNOWN_NUMBER_TYPE',
        decision: 'BLOCKED_UNKNOWN_NUMBER_TYPE',
      });
    }

    try {
      const result =
        await getRegulatorySupportingDocumentFieldRequirements({
          userId,
          provider: candidate.provider,
          country: candidate.isoCountry,
          numberType:
            candidate.regulatoryNumberType,
          endUserType: 'individual',
          requirementName,
          documentType,
        });

      if (!result.resolved) {
        return res.status(409).json(result);
      }

      return res.status(200).json(result);
    } catch {
      return res.status(502).json({
        error:
          'Regulatory document requirements lookup failed',
      });
    }
  }
);

router.post(
  '/regulatory/documents',
  requireAuth,
  runRegulatoryDocumentUpload,
  async (req, res) => {
    const userId = req.user.id;

    const e164 = String(
      req.body?.e164 || ''
    ).trim();

    const requirementName = String(
      req.body?.requirementName || ''
    ).trim();

    const documentType = String(
      req.body?.documentType || ''
    ).trim();

    if (!e164) {
      return res.status(400).json({
        error: 'e164 required',
      });
    }

    if (!requirementName) {
      return res.status(400).json({
        error: 'requirementName required',
      });
    }

    if (!documentType) {
      return res.status(400).json({
        error: 'documentType required',
      });
    }

    const parsedAttributes =
      parseRegulatoryDocumentAttributes(
        req.body?.attributes
      );

    if (!parsedAttributes.valid) {
      return res.status(400).json({
        error:
          'INVALID_REGULATORY_DOCUMENT_ATTRIBUTES',
      });
    }

    const isMultipart =
      String(
        req.headers['content-type'] || ''
      )
        .toLowerCase()
        .startsWith('multipart/form-data');

    if (isMultipart && !req.file) {
      return res.status(400).json({
        error: 'REGULATORY_DOCUMENT_FILE_REQUIRED',
      });
    }

    const candidate =
      await prisma.phoneNumber.findFirst({
        where: {
          e164,
          status: 'AVAILABLE',
          isLeasable: true,
        },
      });

    if (!candidate) {
      return res.status(404).json({
        error: 'Number not available',
      });
    }

    if (!candidate.regulatoryNumberType) {
      return res.status(409).json({
        error: 'BLOCKED_UNKNOWN_NUMBER_TYPE',
        decision: 'BLOCKED_UNKNOWN_NUMBER_TYPE',
      });
    }

    try {
      const result =
        await provisionRegulatorySupportingDocument({
          userId,
          provider: candidate.provider,
          country: candidate.isoCountry,
          numberType:
            candidate.regulatoryNumberType,
          endUserType: 'individual',
          requirementName,
          documentType,
          attributes:
            parsedAttributes.attributes,
          friendlyName:
            req.body?.friendlyName,
          file: req.file,
        });

      if (!result.provisioned) {
        return res.status(409).json(result);
      }

      return res.status(200).json(result);
    } catch {
      return res.status(502).json({
        error:
          'Regulatory document provisioning failed',
      });
    }
  }
);

router.post(
  '/regulatory/assemble',
  requireAuth,
  async (req, res) => {
    const userId = req.user.id;

    const e164 = String(
      req.body?.e164 || ''
    ).trim();

    const email = String(
      req.body?.email || ''
    ).trim();

    const friendlyName =
      req.body?.friendlyName === undefined
        ? undefined
        : String(
            req.body.friendlyName || ''
          ).trim();

    if (!e164) {
      return res.status(400).json({
        error: 'e164 required',
      });
    }

    if (!email) {
      return res.status(400).json({
        error: 'email required',
      });
    }

    const candidate =
      await prisma.phoneNumber.findFirst({
        where: {
          e164,
          status: 'AVAILABLE',
          isLeasable: true,
        },
      });

    if (!candidate) {
      return res.status(404).json({
        error: 'Number not available',
      });
    }

    if (!candidate.regulatoryNumberType) {
      return res.status(409).json({
        error: 'BLOCKED_UNKNOWN_NUMBER_TYPE',
        decision: 'BLOCKED_UNKNOWN_NUMBER_TYPE',
      });
    }

    try {
      const webhookBase = String(
        process.env.TWILIO_WEBHOOK_BASE_URL || ''
      )
        .trim()
        .replace(/\/+$/, '');

      if (!webhookBase) {
        return res.status(503).json({
          error:
            'Regulatory status callback is not configured',
        });
      }

      const statusCallback =
        `${webhookBase}/webhooks/twilio/regulatory-status`;

      const result =
        await assembleRegulatoryBundle({
          userId,
          provider: candidate.provider,
          country: candidate.isoCountry,
          numberType:
            candidate.regulatoryNumberType,
          endUserType: 'individual',
          email,
          friendlyName,
          statusCallback,
        });

      if (!result.assembled) {
        return res.status(409).json(result);
      }

      return res.status(200).json(result);
    } catch {
      return res.status(502).json({
        error:
          'Regulatory Bundle assembly failed',
      });
    }
  }
);

router.post(
  '/regulatory/submit',
  requireAuth,
  async (req, res) => {
    const userId = req.user.id;

    const e164 = String(
      req.body?.e164 || ''
    ).trim();

    if (!e164) {
      return res.status(400).json({
        error: 'e164 required',
      });
    }

    const candidate =
      await prisma.phoneNumber.findFirst({
        where: {
          e164,
          status: 'AVAILABLE',
          isLeasable: true,
        },
      });

    if (!candidate) {
      return res.status(404).json({
        error: 'Number not available',
      });
    }

    if (!candidate.regulatoryNumberType) {
      return res.status(409).json({
        error: 'BLOCKED_UNKNOWN_NUMBER_TYPE',
        decision: 'BLOCKED_UNKNOWN_NUMBER_TYPE',
      });
    }

    try {
      const reviewReservation =
        await prisma.$transaction(async (tx) => {
          await tx.$executeRaw`
            SELECT pg_advisory_xact_lock(
              CAST(${candidate.id} AS integer),
              CAST(1 AS integer)
            )
          `;

          const now = new Date();

          const reservation =
            await tx.numberReservation.findFirst({
              where: {
                phoneNumberId: candidate.id,
                userId,
                purpose:
                  'REGULATORY_VERIFICATION',
                expiresAt: {
                  gt: now,
                },
              },
              orderBy: {
                createdAt: 'desc',
              },
            });

          if (!reservation) {
            return null;
          }

          const reviewDays = Math.max(
            1,
            Number(
              process.env
                .REGULATORY_REVIEW_RESERVATION_DAYS
            ) || 7
          );

          const expiresAt = new Date(
            now.getTime() +
              reviewDays * 24 * 60 * 60 * 1000
          );

          return tx.numberReservation.update({
            where: {
              id: reservation.id,
            },
            data: {
              expiresAt,
            },
          });
        });

      if (!reviewReservation) {
        return res.status(409).json({
          error:
            'REGULATORY_RESERVATION_EXPIRED',
          decision:
            'REGULATORY_RESERVATION_EXPIRED',
        });
      }

      const result =
        await submitNumberRegulatoryBundle({
          userId,
          provider: candidate.provider,
          country: candidate.isoCountry,
          numberType:
            candidate.regulatoryNumberType,
          endUserType: 'individual',
        });

      if (!result.submitted) {
        return res.status(409).json(result);
      }

      return res.status(200).json(result);
    } catch {
      return res.status(502).json({
        error:
          'Regulatory Bundle submission failed',
      });
    }
  }
);

router.post('/lease', requireAuth, async (req, res) => {
  const rawE164 = req.body?.e164
    ? String(req.body.e164)
    : null;

  const cleanE164 = rawE164
    ? normalizeE164(rawE164)
    : null;

  if (cleanE164 && !isE164(cleanE164)) {
    return res.status(400).json({
      error: 'Invalid e164',
    });
  }

  const purchaseIntent =
    parseBoolean(req.body?.purchaseIntent) === true;

  const user = await prisma.user.findUnique({
    where: { id: req.user.id },
    select: { plan: true },
  });

  const plan = user?.plan || 'FREE';

  if (purchaseIntent && plan !== 'PREMIUM') {
    return res.status(403).json({
      error: 'Premium required to purchase this number',
    });
  }

  const areaCode = req.body?.areaCode
    ? String(req.body.areaCode)
    : undefined;

  const country =
    normalizeCountryIso2(req.body?.country) || 'US';

  const capability = req.body?.capability
    ? String(req.body.capability)
    : null;

  const caps = parseCapsParam(req.body?.caps);

  // If user already has a number, don't lease another.
  const existing =
    await prisma.phoneNumber.findFirst({
      where: {
        assignedUserId: req.user.id,
        status: {
          in: ['ASSIGNED', 'HOLD'],
        },
      },
    });

  if (existing) {
    return res.status(409).json({
      error: 'User already has a number',
      number: existing,
    });
  }

  const excludedCandidateIds = [];
  const maxAttempts = cleanE164 ? 1 : 3;

  try {
    for (
      let attempt = 0;
      attempt < maxAttempts;
      attempt += 1
    ) {
      let candidate = null;

      if (cleanE164) {
        candidate =
          await prisma.phoneNumber.findFirst({
            where: {
              e164: cleanE164,
              status: 'AVAILABLE',
              provider: 'twilio',
              ...(purchaseIntent
                ? { isPurchasable: true }
                : { isLeasable: true }),
            },
          });
      } else {
        const where = buildPoolWhere({
          areaCode,
          country,
          capability,
          caps,
          forSale:
            purchaseIntent ? true : false,
        });

        if (excludedCandidateIds.length) {
          where.id = {
            notIn: excludedCandidateIds,
          };
        }

        candidate =
          await prisma.phoneNumber.findFirst({
            where,
            orderBy: [
              { vanity: 'desc' },
              { id: 'asc' },
            ],
          });
      }

      if (!candidate) {
        return res.status(404).json({
          error: cleanE164
            ? 'That number is no longer available.'
            : purchaseIntent
              ? 'No premium numbers available in inventory'
              : 'No available numbers in pool',
        });
      }

      const compliance =
        await evaluateNumberRegulatoryCompliance({
          userId: req.user.id,
          candidate,
          endUserType: 'individual',
        });

      if (!compliance?.allowed) {
        return res.status(409).json({
          error:
            compliance?.decision ||
            'REGULATORY_COMPLIANCE_BLOCKED',
          decision:
            compliance?.decision ||
            'BLOCKED_UNKNOWN_STATUS',
          requiresVerification:
            Boolean(
              compliance?.requiresVerification
            ),
          regulation:
            compliance?.regulation || null,
          profile:
            compliance?.profile || null,
        });
      }

      const leaseResult =
        await prisma.$transaction(
          async (tx) => {
            await tx.$executeRaw`
              SELECT pg_advisory_xact_lock(
                CAST(${candidate.id} AS integer),
                CAST(1 AS integer)
              )
            `;

            const now = new Date();

            const activeRegulatoryReservation =
              await tx.numberReservation.findFirst({
                where: {
                  phoneNumberId: candidate.id,
                  purpose:
                    'REGULATORY_VERIFICATION',
                  expiresAt: {
                    gt: now,
                  },
                },
                orderBy: {
                  createdAt: 'desc',
                },
              });

            if (
              activeRegulatoryReservation &&
              activeRegulatoryReservation.userId !==
                req.user.id
            ) {
              return {
                outcome:
                  'REGULATORY_RESERVED',
                number: null,
              };
            }

            const updated =
              await tx.phoneNumber.updateMany({
                where: {
                  id: candidate.id,
                  status: 'AVAILABLE',
                  ...(purchaseIntent
                    ? {
                        isPurchasable: true,
                      }
                    : {
                        isLeasable: true,
                      }),
                },
                data: {
                  status: 'ASSIGNED',
                  assignedUserId: req.user.id,
                  assignedAt: new Date(),
                  holdUntil: null,
                  releaseAfter: null,

                  locality:
                    candidate.locality ?? null,
                  region:
                    candidate.region ?? null,

                  isLeasable: false,
                  isPurchasable: false,

                  keepLocked:
                    purchaseIntent
                      ? true
                      : false,

                  ...(purchaseIntent
                    ? { forSale: false }
                    : {}),
                },
              });

            if (updated.count !== 1) {
              return {
                outcome: 'RACE_LOST',
                number: null,
              };
            }

            if (
              activeRegulatoryReservation &&
              activeRegulatoryReservation.userId ===
                req.user.id
            ) {
              await tx.numberReservation.deleteMany({
                where: {
                  phoneNumberId: candidate.id,
                  userId: req.user.id,
                  purpose:
                    'REGULATORY_VERIFICATION',
                },
              });
            }

            const number =
              await tx.phoneNumber.findUnique({
                where: {
                  id: candidate.id,
                },
              });

            return {
              outcome: 'LEASED',
              number,
            };
          }
        );

      if (
        leaseResult?.outcome === 'LEASED' &&
        leaseResult.number
      ) {
        return res.json({
          ok: true,
          number: leaseResult.number,
          policy: getPolicy(plan),
        });
      }

      if (
        leaseResult?.outcome ===
        'REGULATORY_RESERVED'
      ) {
        if (cleanE164) {
          return res.status(409).json({
            error: 'NUMBER_REGULATORY_RESERVED',
            decision:
              'NUMBER_REGULATORY_RESERVED',
          });
        }

        excludedCandidateIds.push(candidate.id);
        continue;
      }

      // The exact candidate lost an assignment race.
      // Explicit selections cannot silently switch numbers.
      if (cleanE164) {
        return res.status(404).json({
          error:
            'That number is no longer available.',
        });
      }

      excludedCandidateIds.push(candidate.id);
    }

    return res.status(409).json({
      error:
        'Number inventory changed. Please try again.',
    });
  } catch (err) {
    console.error('Lease failed:', err);

    return res.status(500).json({
      error: 'Lease failed',
    });
  }
});

/**
 * POST /numbers/reserve
 * POST /numbers/claim
 *
 * Kept for internal tooling / older flow.
 * The user UI should not call these anymore once BUY is inventory-based.
 */
router.post('/reserve', requireAuth, async (req, res) => {
  const { e164 } = req.body || {};
  if (!e164) return res.status(400).json({ error: 'e164 required' });

  const clean = normalizeE164(e164);
  if (!isE164(clean)) return res.status(400).json({ error: 'Invalid e164' });

  const ttlMinutes = Number(process.env.RESERVATION_MINUTES) || 10;
  const expiresAt = new Date(Date.now() + ttlMinutes * 60 * 1000);

  try {
    const api = await resolveTwilioProvider();
    const providerName = api.providerName || defaultProviderName || 'twilio';

    let phone = await prisma.phoneNumber.findUnique({ where: { e164: clean } });

    if (!phone) {
      phone = await prisma.phoneNumber.create({
        data: { e164: clean, provider: providerName, status: 'RESERVED', source: 'TWILIO_SEARCH' },
      });
    } else {
      if (!['AVAILABLE', 'RESERVED'].includes(phone.status)) {
        return res.status(409).json({ error: 'Number not available' });
      }
      await prisma.phoneNumber.update({
        where: { id: phone.id },
        data: { status: 'RESERVED', provider: providerName, source: 'TWILIO_SEARCH' },
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

router.post('/claim', requireAuth, async (req, res) => {
  const { e164, lockOnAssign } = req.body || {};
  if (!e164) return res.status(400).json({ error: 'e164 required' });

  const clean = normalizeE164(e164);
  if (!isE164(clean)) return res.status(400).json({ error: 'Invalid e164' });

  try {
    const phone = await prisma.phoneNumber.findUnique({ where: { e164: clean } });
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

    const result = await api.purchaseNumber({ phoneNumber: clean });

    const purchasedE164 = result?.e164 || clean;
    const purchasedCaps = result?.capabilities || phone.capabilities || {
      sms: true,
      voice: true,
      mms: false,
    };

    await prisma.phoneNumber.update({
      where: { id: phone.id },
      data: {
        e164: purchasedE164,
        status: 'ASSIGNED',
        assignedUserId: req.user.id,
        assignedAt: new Date(),
        provider: providerName,

        // Premium/locked behavior
        keepLocked: Boolean(lockOnAssign),

        // Twilio metadata
        twilioSid: result?.sid || phone.twilioSid || null,
        isoCountry: result?.isoCountry || phone.isoCountry || 'US',
        capabilities: purchasedCaps,

        // Simple US area code parse: +1760xxxxxxx -> 760
        areaCode:
          purchasedE164?.startsWith('+1') && purchasedE164.length >= 5
            ? purchasedE164.slice(2, 5)
            : phone.areaCode || null,

        // Clear temporary lifecycle fields
        holdUntil: null,
        releaseAfter: null,
        lastOutboundAt: null,
        source: 'PROVISIONED',
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
 * Release current user's leased number back to pool via HOLD quarantine.
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

    if (phone.keepLocked) {
      return res
        .status(403)
        .json({ error: 'Number is locked (Premium). Disable lock to release.' });
    }

    const holdDays = Number(process.env.NUMBER_HOLD_DAYS) || 14;
    const holdUntil = new Date(Date.now() + holdDays * 24 * 60 * 60 * 1000);

    await prisma.phoneNumber.update({
      where: { id: phone.id },
      data: {
        status: 'HOLD',
        assignedUserId: null,
        assignedAt: null,
        keepLocked: false,
        holdUntil,
        releaseAfter: null,
        isLeasable: false,
        isPurchasable: false,
      },
    });

    res.json({ ok: true, holdUntil });
  } catch (err) {
    console.error('Release failed:', err);
    res.status(500).json({ error: 'Release failed' });
  }
});

/**
 * POST /numbers/keep/enable  (Premium)
 * Locks number from auto-recycling
 */
router.post('/keep/enable', requireAuth, requirePremium, async (req, res) => {
  const phone = await prisma.phoneNumber.findFirst({
    where: { assignedUserId: req.user.id, status: { in: ['ASSIGNED', 'HOLD'] } },
  });
  if (!phone) return res.status(404).json({ error: 'No number' });

  await prisma.phoneNumber.update({
    where: { id: phone.id },
    data: { keepLocked: true, status: 'ASSIGNED', holdUntil: null },
  });

  res.json({ ok: true });
});

router.post('/buy/keep-current', requireAuth, async (req, res) => {
  try {
    const phone = await prisma.phoneNumber.findFirst({
      where: { assignedUserId: req.user.id, status: 'ASSIGNED' },
      orderBy: { id: 'asc' },
    });
    if (!phone) return res.status(404).json({ error: 'No assigned number' });

    if (phone.keepLocked) {
      return res.json({ ok: true, number: phone, note: 'Already locked' });
    }

    // TODO: billing / entitlement gate:
    // - requirePremium middleware here OR
    // - charge one-time "keep number" product

    const updated = await prisma.phoneNumber.update({
      where: { id: phone.id },
      data: { keepLocked: true, holdUntil: null, releaseAfter: null, status: 'ASSIGNED' },
    });

    return res.json({ ok: true, number: updated, policy: getPolicy('PREMIUM') });
  } catch (e) {
    console.error('Keep-current failed:', e);
    return res.status(500).json({ error: 'Could not keep current number' });
  }
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
