import { getEsimProviderConfig } from '../../config/esim.js';
import { telnaRequest } from '../../utils/telnaClient.js';

/**
 * Telna Connect v2.1 provider adapter.
 *
 * Responsibilities:
 * - Discover eSIM-capable SIMs from the configured Telna inventory.
 * - Retrieve the eUICC profile associated with an ICCID.
 * - Create Telna packages from configured package-template IDs.
 * - Retrieve package usage/status.
 *
 * Chatforia remains responsible for ownership/allocation of ICCIDs.
 * The Subscriber.iccid @unique constraint is the final concurrency guard.
 *
 * IMPORTANT:
 * - Telna does not expose a documented "reserve eSIM" operation in the
 *   Connect v2.1 API we have been given.
 * - We do not manufacture production LPA/QR payloads.
 * - We do not treat package termination as SIM suspension.
 */

const TELNA = getEsimProviderConfig('telna');

const SIM_LIST_PAGE_SIZE = 100;

const EUICC_STATES = new Set([
  'AVAILABLE',
  'ALLOCATED',
  'LINKED',
  'CONFIRMED',
  'RELEASED',
  'DOWNLOADED',
  'INSTALLED',
  'ENABLED',
  'DISABLED',
  'ERROR',
  'UNAVAILABLE',
  'DELETED',
]);

function ensureConfigured() {
  if (!TELNA?.baseUrl || !TELNA?.apiKey) {
    const err = new Error(
      'Telna not configured (missing baseUrl or API key)'
    );
    err.code = 'TELNA_NOT_CONFIGURED';
    throw err;
  }
}

function ensureInventoryConfigured() {
  ensureConfigured();

  if (
    TELNA.inventoryId === null ||
    TELNA.inventoryId === undefined ||
    TELNA.inventoryId === ''
  ) {
    const err = new Error(
      'Telna inventory is not configured'
    );
    err.code = 'TELNA_INVENTORY_NOT_CONFIGURED';
    throw err;
  }
}

function isMockMode(testMode = false) {
  return (
    testMode === true ||
    process.env.ESIM_MOCK === 'true'
  );
}

function makeError(message, code, providerMeta = null) {
  const err = new Error(message);
  err.code = code;

  if (providerMeta !== null) {
    err.providerMeta = providerMeta;
  }

  return err;
}

function wrapProviderError(prefix, fallbackCode, err) {
  const wrapped = new Error(`${prefix}: ${err.message}`);

  wrapped.code = err.code || fallbackCode;
  wrapped.providerMeta =
    err.providerMeta ??
    err.providerBody ??
    null;

  if (err.requestId) {
    wrapped.requestId = err.requestId;
  }

  if (err.status) {
    wrapped.status = err.status;
  }

  return wrapped;
}

function normalizeIccid(value) {
  if (value === null || value === undefined) {
    return null;
  }

  const normalized = String(value).trim();
  return normalized || null;
}

function makeIccidHint(iccid) {
  const normalized = normalizeIccid(iccid);

  if (!normalized) {
    return null;
  }

  if (normalized.length <= 6) {
    return normalized;
  }

  return `${normalized.slice(0, 6)}••••••`;
}

function normalizeDate(value) {
  if (!value) {
    return null;
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return date;
}

function bytesToMb(value) {
  if (
    typeof value !== 'number' ||
    !Number.isFinite(value) ||
    value < 0
  ) {
    return null;
  }

  return value / (1024 * 1024);
}

function normalizeExcludedIccids(excludedIccids) {
  if (!Array.isArray(excludedIccids)) {
    return new Set();
  }

  return new Set(
    excludedIccids
      .map(normalizeIccid)
      .filter(Boolean)
  );
}

function getPackageTemplateMap() {
  const map = TELNA?.packageTemplateMap;

  if (
    !map ||
    typeof map !== 'object' ||
    Array.isArray(map)
  ) {
    return {};
  }

  return map;
}

function resolvePackageTemplateId({
  planCode,
  addonKind,
} = {}) {
  const map = getPackageTemplateMap();

  const candidates = [
    planCode,
    addonKind,
  ]
    .filter(
      (value) =>
        typeof value === 'string' &&
        value.trim()
    )
    .map((value) => value.trim());

  for (const key of candidates) {
    const rawValue = map[key];

    if (
      rawValue !== null &&
      rawValue !== undefined &&
      rawValue !== ''
    ) {
      const id = Number(rawValue);

      if (
        Number.isInteger(id) &&
        id > 0
      ) {
        return id;
      }
    }
  }

  return null;
}

function normalizeEuiccProfile(data, fallbackIccid = null) {
  const iccid =
    normalizeIccid(data?.iccid) ||
    normalizeIccid(fallbackIccid);

  const state =
    typeof data?.state === 'string'
      ? data.state.toUpperCase()
      : null;

  return {
    // Telna's documented eUICC profile resource is addressed by ICCID.
    // Keep providerProfileId populated for Chatforia's existing provider
    // abstraction, but do not invent a separate Telna profile identifier.
    providerProfileId: iccid,

    iccid,
    iccidHint: makeIccidHint(iccid),

    /*
     * Telna production returns activation_code as the complete
     * LPA activation string used for QR-code generation.
     *
     * Preserve Telna's value exactly. Never reconstruct, prepend,
     * append, or otherwise manufacture an LPA payload.
     */
    smdp: null,
    activationCode:
      data?.activation_code ??
      null,

    lpaUri:
      typeof data?.activation_code === 'string' &&
      data.activation_code.startsWith('LPA:1$')
        ? data.activation_code
        : null,

    qrPayload:
      typeof data?.activation_code === 'string' &&
      data.activation_code.startsWith('LPA:1$')
        ? data.activation_code
        : null,

    state,
    providerMeta: data ?? null,
  };
}

async function getEuiccProfile(iccid) {
  const normalizedIccid = normalizeIccid(iccid);

  if (!normalizedIccid) {
    throw makeError(
      'Telna eUICC profile lookup requires ICCID',
      'TELNA_MISSING_ICCID'
    );
  }

  const path =
    `/v2.1/esim-rsp/euicc-profiles/` +
    encodeURIComponent(normalizedIccid);

  return telnaRequest(path, {
    method: 'GET',
  });
}

async function listSimRegistryPage({
  offset = 0,
  count = SIM_LIST_PAGE_SIZE,
} = {}) {
  ensureInventoryConfigured();

  const params = new URLSearchParams();

  params.set(
    'inventory',
    String(TELNA.inventoryId)
  );

  if (
    TELNA.groupId !== null &&
    TELNA.groupId !== undefined &&
    TELNA.groupId !== ''
  ) {
    params.set(
      'group',
      String(TELNA.groupId)
    );
  }

  params.set(
    'count',
    String(count)
  );

  params.set(
    'offset',
    String(offset)
  );

  const path =
    `/v2.1/inventory/sim-registries?${params.toString()}`;

  return telnaRequest(path, {
    method: 'GET',
  });
}

/**
 * Discover a Telna eSIM candidate.
 *
 * The name reserveEsimProfile is retained for compatibility with
 * Chatforia's provider abstraction. Telna Connect v2.1 does not expose
 * a documented reserve operation, so this function performs discovery
 * only.
 *
 * The caller must atomically claim the returned ICCID in Chatforia's
 * database. If another request wins the Subscriber.iccid unique race,
 * call this function again with that ICCID in excludedIccids.
 *
 * params:
 * {
 *   userId?,
 *   region,
 *   testMode?,
 *   excludedIccids?: string[]
 * }
 */
export async function reserveEsimProfile({
  userId,
  region,
  testMode = false,
  excludedIccids = [],
} = {}) {
  if (
    !region ||
    typeof region !== 'string'
  ) {
    throw makeError(
      'reserveEsimProfile requires region (string)',
      'TELNA_INVALID_REGION'
    );
  }

  if (isMockMode(testMode)) {
    const now = Date.now();
    const profileId = `mock-telna-${now}`;

    const activationCode =
      `ACT-${Math.random()
        .toString(36)
        .slice(2, 10)
        .toUpperCase()}`;

    const smdp =
      'mock.smdp.chatforia.com';

    const lpaUri =
      `LPA:1$${smdp}$${activationCode}`;

    const iccid = `890000${now}`;

    return {
      providerProfileId: profileId,
      iccid,
      iccidHint: makeIccidHint(iccid),
      smdp,
      activationCode,
      lpaUri,
      qrPayload: lpaUri,
      providerMeta: {
        mock: true,
        testMode: Boolean(testMode),
        userId: userId ?? null,
        region,
        profileId,
        iccid,
      },
    };
  }

  ensureInventoryConfigured();

  const excluded =
    normalizeExcludedIccids(excludedIccids);

  try {
    let offset = 0;

    while (true) {
      const page =
        await listSimRegistryPage({
          offset,
          count: SIM_LIST_PAGE_SIZE,
        });

      const sims =
        Array.isArray(page?.sims)
          ? page.sims
          : [];

      if (sims.length === 0) {
        break;
      }

      for (const sim of sims) {
        const iccid =
          normalizeIccid(sim?.iccid);

        if (
          !iccid ||
          excluded.has(iccid)
        ) {
          continue;
        }

        try {
          const profile =
            await getEuiccProfile(iccid);

          const state =
            typeof profile?.state === 'string'
              ? profile.state.toUpperCase()
              : null;

          if (
            state &&
            !EUICC_STATES.has(state)
          ) {
            continue;
          }

          /*
           * Telna production inventory currently exposes unused
           * Chatforia eSIMs as:
           *
           *   SIM Registry: pre-service
           *   eUICC Profile: RELEASED
           *
           * AVAILABLE is also an allocatable eUICC state.
           *
           * Require pre-service at the SIM level so profiles that are
           * already in service are never selected, regardless of their
           * eUICC state.
           */
          const simStatus =
            typeof sim?.sim_status === 'string'
              ? sim.sim_status.toLowerCase()
              : null;

          const hasActivationCode =
            typeof profile?.activation_code === 'string' &&
            profile.activation_code.trim().length > 0;

          const allocatableState =
            state === 'AVAILABLE' ||
            state === 'RELEASED';

          if (
            simStatus !== 'pre-service' ||
            !allocatableState ||
            !hasActivationCode
          ) {
            continue;
          }

          const normalized =
            normalizeEuiccProfile(
              profile,
              iccid
            );

          return {
            ...normalized,

            providerMeta: {
              discovery: {
                inventoryId:
                  TELNA.inventoryId,
                groupId:
                  TELNA.groupId ?? null,
                offset,
                simRegistry: sim,
              },
              euiccProfile:
                profile ?? null,
            },
          };
        } catch (err) {
          /*
           * A SIM registry entry is not necessarily guaranteed to have
           * a usable eUICC profile. Skip a missing/unusable candidate,
           * but do not hide authentication/server failures.
           */
          if (
            err?.status === 404
          ) {
            continue;
          }

          throw err;
        }
      }

      const total =
        typeof page?.total === 'number'
          ? page.total
          : null;

      offset += sims.length;

      if (
        sims.length < SIM_LIST_PAGE_SIZE ||
        (total !== null && offset >= total)
      ) {
        break;
      }
    }

    throw makeError(
      'No available Telna eSIM profiles were found in the configured inventory',
      'TELNA_NO_AVAILABLE_PROFILE'
    );
  } catch (err) {
    if (
      err?.code ===
      'TELNA_NO_AVAILABLE_PROFILE'
    ) {
      throw err;
    }

    throw wrapProviderError(
      'Telna reserveEsimProfile failed',
      'TELNA_RESERVE_FAILED',
      err
    );
  }
}

/**
 * Telna Connect v2.1 does not expose the old assumed
 * POST /esim/activate operation.
 *
 * For a real Telna profile, activation state is observed from the
 * eUICC profile. This function therefore performs a read-only status
 * lookup rather than inventing a write operation.
 */
export async function activateProfile({
  providerProfileId,
  iccid,
  activationCode,
  testMode = false,
} = {}) {
  if (
    !providerProfileId &&
    !iccid &&
    !activationCode
  ) {
    throw makeError(
      'activateProfile requires providerProfileId, iccid, or activationCode',
      'TELNA_MISSING_ACTIVATION_IDENTIFIERS'
    );
  }

  if (isMockMode(testMode)) {
    const activatedAt = new Date();

    return {
      ok: true,
      activatedAt,
      msisdn: null,
      providerMeta: {
        mock: true,
        testMode: Boolean(testMode),
        providerProfileId:
          providerProfileId || null,
        iccid: iccid || null,
        activatedAt:
          activatedAt.toISOString(),
      },
    };
  }

  ensureConfigured();

  /*
   * For Telna v2.1, Chatforia normalizes providerProfileId to ICCID.
   * activationCode alone cannot identify the profile endpoint.
   */
  const lookupIccid =
    normalizeIccid(iccid) ||
    normalizeIccid(providerProfileId);

  if (!lookupIccid) {
    throw makeError(
      'Telna activation status lookup requires ICCID',
      'TELNA_MISSING_ICCID'
    );
  }

  try {
    const data =
      await getEuiccProfile(
        lookupIccid
      );

    const state =
      typeof data?.state === 'string'
        ? data.state.toUpperCase()
        : null;

    const activatedAt =
      normalizeDate(
        data?.last_operation_date
      );

    return {
      // Do not mark a merely AVAILABLE/ALLOCATED profile active.
      ok: state === 'ENABLED',

      activatedAt:
        state === 'ENABLED' &&
        activatedAt
          ? activatedAt
          : undefined,

      msisdn: null,

      providerMeta:
        data ?? null,
    };
  } catch (err) {
    throw wrapProviderError(
      'Telna activateProfile failed',
      'TELNA_ACTIVATE_FAILED',
      err
    );
  }
}

/**
 * Provision a Telna package.
 *
 * Real Telna v2.1 package creation requires:
 * {
 *   sim: ICCID,
 *   package_template: integer
 * }
 *
 * package-template IDs come only from TELNA_PACKAGE_TEMPLATE_MAP.
 * There is intentionally no production fallback to a test template.
 */
export async function provisionEsimPack({
  userId,
  providerProfileId,
  iccid,
  addonKind,
  planCode,
  testMode = false,
  timeAllowance,
} = {}) {
  if (
    !userId ||
    !providerProfileId ||
    !addonKind
  ) {
    throw makeError(
      'provisionEsimPack requires userId, providerProfileId and addonKind',
      'TELNA_INVALID_PROVISION_PARAMS'
    );
  }

  if (isMockMode(testMode)) {
    const now = Date.now();

    return {
      providerPurchaseId:
        `mock-purchase-${now}`,

      providerProfileId:
        String(providerProfileId),

      // Preserve the ICCID created during mock reservation.
      iccid:
        normalizeIccid(iccid),

      qrCodeSvg: null,

      expiresAt: new Date(
        now +
        30 * 24 * 60 * 60 * 1000
      ),

      dataMb: null,

      providerMeta: {
        mock: true,
        testMode:
          Boolean(testMode),
        addonKind,
        planCode:
          planCode || addonKind,
        iccid:
          normalizeIccid(iccid),
      },
    };
  }

  ensureConfigured();

  const simIccid =
    normalizeIccid(iccid) ||
    normalizeIccid(providerProfileId);

  if (!simIccid) {
    throw makeError(
      'Telna package provisioning requires ICCID',
      'TELNA_MISSING_ICCID'
    );
  }

  const packageTemplateId =
    resolvePackageTemplateId({
      planCode,
      addonKind,
    });

  if (!packageTemplateId) {
    throw makeError(
      `No Telna package template is configured for plan "${planCode || addonKind}"`,
      'TELNA_PACKAGE_TEMPLATE_NOT_CONFIGURED'
    );
  }

  const payload = {
    sim: simIccid,
    package_template:
      packageTemplateId,
  };

  if (
    timeAllowance !== undefined &&
    timeAllowance !== null
  ) {
    const normalizedTimeAllowance =
      Number(timeAllowance);

    if (
      !Number.isInteger(
        normalizedTimeAllowance
      ) ||
      normalizedTimeAllowance <= 0
    ) {
      throw makeError(
        'timeAllowance must be a positive integer number of seconds',
        'TELNA_INVALID_TIME_ALLOWANCE'
      );
    }

    payload.time_allowance =
      normalizedTimeAllowance;
  }

  try {
    const data =
      await telnaRequest(
        '/v2.1/pcr/packages',
        {
          method: 'POST',
          body: payload,
        }
      );

    const packageId =
      data?.id ?? null;

    if (
      packageId === null ||
      packageId === undefined
    ) {
      throw makeError(
        'Telna package creation did not return a package id',
        'TELNA_PACKAGE_ID_MISSING',
        data ?? null
      );
    }

    const expiresAt =
      normalizeDate(
        data?.expiry_date ??
        data?.expires_at ??
        data?.expiry
      );

    return {
      providerPurchaseId:
        String(packageId),

      providerProfileId:
        simIccid,

      iccid:
        normalizeIccid(
          data?.sim
        ) || simIccid,

      qrCodeSvg: null,

      // Package allowances are controlled by the Telna template.
      // Do not infer total MB from Chatforia plan names here.
      dataMb: null,

      expiresAt,

      providerMeta:
        data ?? null,
    };
  } catch (err) {
    throw wrapProviderError(
      'Telna provisionEsimPack failed',
      'TELNA_PROVISION_FAILED',
      err
    );
  }
}

/**
 * Fetch usage/status for a Telna package.
 *
 * IMPORTANT:
 * The identifier for this API is the Telna PACKAGE ID, not the
 * eUICC profile ID/ICCID.
 *
 * We retain a scalar argument temporarily so the provider abstraction
 * can be migrated one layer at a time. The caller must pass the
 * providerPurchaseId after that caller is updated.
 */
export async function fetchEsimUsage(
  providerPurchaseId
) {
  ensureConfigured();

  if (
    providerPurchaseId === null ||
    providerPurchaseId === undefined ||
    String(providerPurchaseId).trim() === ''
  ) {
    throw makeError(
      'fetchEsimUsage requires a Telna package id',
      'TELNA_MISSING_PACKAGE_ID'
    );
  }

  const packageId =
    String(providerPurchaseId).trim();

  try {
    const path =
      `/v2.1/pcr/packages/` +
      encodeURIComponent(packageId);

    const data =
      await telnaRequest(path, {
        method: 'GET',
      });

    /*
     * Telna documents data_usage_remaining in bytes.
     *
     * We can report remaining MB directly. Total/used MB require the
     * package template's allowance, so we do not fabricate them here.
     */
    const remainingMb =
      bytesToMb(
        data?.data_usage_remaining
      );

    const expiresAt =
      normalizeDate(
        data?.expiry_date ??
        data?.expires_at ??
        data?.expiry
      );

    return {
      usedMb: null,
      totalMb: null,
      remainingMb,
      expiresAt,
      providerMeta:
        data ?? null,
    };
  } catch (err) {
    throw wrapProviderError(
      'Telna fetchEsimUsage failed',
      'TELNA_USAGE_FAILED',
      err
    );
  }
}

/**
 * SIM-level suspension is intentionally unsupported here.
 *
 * Telna's documented package PUT operation changes package_status,
 * but terminating a package is not the same thing as suspending a
 * SIM/line. We will not substitute one operation for the other.
 */
export async function suspendLine({
  providerProfileId,
  iccid,
  testMode = false,
} = {}) {
  const id =
    providerProfileId ??
    iccid;

  if (!id) {
    throw makeError(
      'suspendLine requires providerProfileId or iccid',
      'TELNA_MISSING_IDENTIFIER'
    );
  }

  if (isMockMode(testMode)) {
    return {
      ok: true,
      providerMeta: {
        mock: true,
        action: 'suspend',
        providerProfileId:
          providerProfileId || null,
        iccid:
          iccid || null,
      },
    };
  }

  ensureConfigured();

  throw makeError(
    'Telna SIM-level suspension is not configured because no documented Connect v2.1 suspend operation has been confirmed',
    'TELNA_SUSPEND_UNSUPPORTED'
  );
}

/**
 * SIM-level resume is intentionally unsupported for the same reason
 * as suspendLine().
 */
export async function resumeLine({
  providerProfileId,
  iccid,
  testMode = false,
} = {}) {
  const id =
    providerProfileId ??
    iccid;

  if (!id) {
    throw makeError(
      'resumeLine requires providerProfileId or iccid',
      'TELNA_MISSING_IDENTIFIER'
    );
  }

  if (isMockMode(testMode)) {
    return {
      ok: true,
      providerMeta: {
        mock: true,
        action: 'resume',
        providerProfileId:
          providerProfileId || null,
        iccid:
          iccid || null,
      },
    };
  }

  ensureConfigured();

  throw makeError(
    'Telna SIM-level resume is not configured because no documented Connect v2.1 resume operation has been confirmed',
    'TELNA_RESUME_UNSUPPORTED'
  );
}

export default {
  reserveEsimProfile,
  activateProfile,
  provisionEsimPack,
  fetchEsimUsage,
  suspendLine,
  resumeLine,
};