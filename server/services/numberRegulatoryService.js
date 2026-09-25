import prisma from '../utils/prismaClient.js';
import {
  getProvider,
} from '../lib/telco/index.js';

const PROFILE_PROVIDER = 'twilio';

function normalizeProfileKey({
  userId,
  provider = PROFILE_PROVIDER,
  country,
  numberType,
  endUserType,
}) {
  const uid = Number(userId);

  if (!Number.isInteger(uid) || uid <= 0) {
    throw new Error('Invalid userId');
  }

  const normalizedProvider = String(
    provider || PROFILE_PROVIDER
  )
    .trim()
    .toLowerCase();

  const isoCountry = String(country || '')
    .trim()
    .toUpperCase();

  const normalizedNumberType = String(
    numberType || ''
  )
    .trim()
    .toLowerCase();

  const normalizedEndUserType = String(
    endUserType || ''
  )
    .trim()
    .toLowerCase();

  if (!/^[A-Z]{2}$/.test(isoCountry)) {
    throw new Error(
      'country must be a 2-letter ISO country code'
    );
  }

  if (!normalizedNumberType) {
    throw new Error('numberType is required');
  }

  if (
    normalizedEndUserType !== 'individual' &&
    normalizedEndUserType !== 'business'
  ) {
    throw new Error(
      'endUserType must be individual or business'
    );
  }

  return {
    userId: uid,
    provider: normalizedProvider,
    isoCountry,
    numberType: normalizedNumberType,
    endUserType: normalizedEndUserType,
  };
}

function profileUniqueWhere(key) {
  return {
    userId_provider_isoCountry_numberType_endUserType: {
      userId: key.userId,
      provider: key.provider,
      isoCountry: key.isoCountry,
      numberType: key.numberType,
      endUserType: key.endUserType,
    },
  };
}

export async function getRegulatoryProfile(input) {
  const key = normalizeProfileKey(input);

  return prisma.numberRegulatoryProfile.findUnique({
    where: profileUniqueWhere(key),
  });
}

export async function upsertRegulatoryProfile({
  userId,
  provider = PROFILE_PROVIDER,
  country,
  numberType,
  endUserType,
  regulationSid,
  bundleSid,
  endUserSid,
  status,
  providerStatus,
  rejectionReason,
  submittedAt,
  approvedAt,
  validUntil,
}) {
  const key = normalizeProfileKey({
    userId,
    provider,
    country,
    numberType,
    endUserType,
  });

  const mutable = {
    regulationSid,
    bundleSid,
    endUserSid,
    status,
    providerStatus,
    rejectionReason,
    submittedAt,
    approvedAt,
    validUntil,
  };

  const update = Object.fromEntries(
    Object.entries(mutable).filter(
      ([, value]) => value !== undefined
    )
  );

  return prisma.numberRegulatoryProfile.upsert({
    where: profileUniqueWhere(key),
    create: {
      ...key,
      ...update,
    },
    update,
  });
}

export async function syncRegulatoryBundleStatus({
  userId,
  provider = PROFILE_PROVIDER,
  country,
  numberType,
  endUserType,
}) {
  const key = normalizeProfileKey({
    userId,
    provider,
    country,
    numberType,
    endUserType,
  });

  const profile =
    await prisma.numberRegulatoryProfile.findUnique({
      where: profileUniqueWhere(key),
    });

  if (!profile) {
    return {
      profile: null,
      approved: false,
      knownStatus: false,
      reason: 'profile-not-found',
    };
  }

  if (!profile.bundleSid) {
    return {
      profile,
      approved: false,
      knownStatus: true,
      reason: 'bundle-not-created',
    };
  }

  const api = getProvider(key.provider);

  if (
    !api ||
    typeof api.getRegulatoryBundle !== 'function' ||
    typeof api.normalizeRegulatoryBundleStatus !==
      'function'
  ) {
    throw new Error(
      `Regulatory compliance is not supported by provider: ${key.provider}`
    );
  }

  // Provider call intentionally occurs before the DB update.
  const bundle =
    await api.getRegulatoryBundle({
      bundleSid: profile.bundleSid,
    });

  const providerStatus =
    bundle?.status == null
      ? null
      : String(bundle.status);

  const normalizedStatus =
    api.normalizeRegulatoryBundleStatus(
      providerStatus
    );

  if (!normalizedStatus) {
    const updated =
      await prisma.numberRegulatoryProfile.update({
        where: { id: profile.id },
        data: {
          providerStatus,
          validUntil:
            bundle?.validUntil ??
            profile.validUntil,
        },
      });

    return {
      profile: updated,
      approved: false,
      knownStatus: false,
      reason: 'unknown-provider-status',
    };
  }

  const now = new Date();

  const data = {
    status: normalizedStatus,
    providerStatus,
    validUntil:
      bundle?.validUntil ??
      profile.validUntil,
  };

  if (
    normalizedStatus === 'PENDING_REVIEW' &&
    !profile.submittedAt
  ) {
    data.submittedAt = now;
  }

  if (normalizedStatus === 'APPROVED') {
    if (!profile.approvedAt) {
      data.approvedAt = now;
    }

    data.rejectionReason = null;
  }

  if (normalizedStatus === 'REJECTED') {
    data.approvedAt = null;
  }

  const updated =
    await prisma.numberRegulatoryProfile.update({
      where: { id: profile.id },
      data,
    });

  return {
    profile: updated,
    approved:
      normalizedStatus === 'APPROVED',
    knownStatus: true,
    reason: null,
  };
}

export async function evaluateNumberRegulatoryCompliance({
  userId,
  candidate,
  endUserType = 'individual',
}) {
  if (!candidate || typeof candidate !== 'object') {
    throw new Error('candidate is required');
  }

  const provider = String(
    candidate.provider || PROFILE_PROVIDER
  )
    .trim()
    .toLowerCase();

  const country = String(
    candidate.isoCountry || ''
  )
    .trim()
    .toUpperCase();

  const numberType = String(
    candidate.regulatoryNumberType || ''
  )
    .trim()
    .toLowerCase();

  const normalizedEndUserType = String(
    endUserType || ''
  )
    .trim()
    .toLowerCase();

  if (!/^[A-Z]{2}$/.test(country)) {
    return {
      allowed: false,
      decision: 'BLOCKED_UNKNOWN_COUNTRY',
      requiresVerification: false,
      profile: null,
      regulation: null,
    };
  }

  if (!numberType) {
    return {
      allowed: false,
      decision: 'BLOCKED_UNKNOWN_NUMBER_TYPE',
      requiresVerification: false,
      profile: null,
      regulation: null,
    };
  }

  if (
    normalizedEndUserType !== 'individual' &&
    normalizedEndUserType !== 'business'
  ) {
    throw new Error(
      'endUserType must be individual or business'
    );
  }

  const api = getProvider(provider);

  if (
    !api ||
    typeof api.getRegulations !== 'function'
  ) {
    return {
      allowed: false,
      decision: 'BLOCKED_PROVIDER_UNSUPPORTED',
      requiresVerification: false,
      profile: null,
      regulation: null,
    };
  }

  let regulations;

  try {
    regulations = await api.getRegulations({
      country,
      numberType,
      endUserType: normalizedEndUserType,
      includeConstraints: true,
    });
  } catch {
    return {
      allowed: false,
      decision: 'BLOCKED_REGULATION_LOOKUP',
      requiresVerification: false,
      profile: null,
      regulation: null,
    };
  }

  if (!Array.isArray(regulations)) {
    return {
      allowed: false,
      decision: 'BLOCKED_REGULATION_LOOKUP',
      requiresVerification: false,
      profile: null,
      regulation: null,
    };
  }

  if (regulations.length === 0) {
    return {
      allowed: true,
      decision: 'NO_REGULATION',
      requiresVerification: false,
      profile: null,
      regulation: null,
    };
  }

  // We currently persist one profile for the exact
  // provider/country/number-type/end-user-type tuple.
  // Keep the applicable Regulation with the decision so
  // the verification flow knows which Regulation SID to use.
  const regulation = regulations[0];

  let syncResult;

  try {
    syncResult =
      await syncRegulatoryBundleStatus({
        userId,
        provider,
        country,
        numberType,
        endUserType:
          normalizedEndUserType,
      });
  } catch {
    return {
      allowed: false,
      decision: 'BLOCKED_STATUS_SYNC',
      requiresVerification: false,
      profile: null,
      regulation,
    };
  }

  if (syncResult.reason === 'profile-not-found') {
    return {
      allowed: false,
      decision: 'VERIFICATION_REQUIRED',
      requiresVerification: true,
      profile: null,
      regulation,
    };
  }

  if (syncResult.reason === 'bundle-not-created') {
    return {
      allowed: false,
      decision: 'VERIFICATION_REQUIRED',
      requiresVerification: true,
      profile: syncResult.profile,
      regulation,
    };
  }

  if (
    syncResult.reason ===
    'unknown-provider-status'
  ) {
    return {
      allowed: false,
      decision: 'BLOCKED_UNKNOWN_STATUS',
      requiresVerification: false,
      profile: syncResult.profile,
      regulation,
    };
  }

  const profile = syncResult.profile;
  const status = profile?.status || null;

  if (status === 'APPROVED') {
    const validUntil = profile.validUntil
      ? new Date(profile.validUntil)
      : null;

    if (
      validUntil &&
      !Number.isNaN(validUntil.getTime()) &&
      validUntil.getTime() <= Date.now()
    ) {
      return {
        allowed: false,
        decision: 'VERIFICATION_REQUIRED',
        requiresVerification: true,
        profile,
        regulation,
      };
    }

    return {
      allowed: true,
      decision: 'APPROVED',
      requiresVerification: false,
      profile,
      regulation,
    };
  }

  if (
    status === 'NOT_STARTED' ||
    status === 'DRAFT' ||
    status === 'EXPIRED'
  ) {
    return {
      allowed: false,
      decision: 'VERIFICATION_REQUIRED',
      requiresVerification: true,
      profile,
      regulation,
    };
  }

  if (
    status === 'PENDING_REVIEW' ||
    status === 'IN_REVIEW'
  ) {
    return {
      allowed: false,
      decision: 'VERIFICATION_PENDING',
      requiresVerification: false,
      profile,
      regulation,
    };
  }

  if (status === 'REJECTED') {
    return {
      allowed: false,
      decision: 'VERIFICATION_REJECTED',
      requiresVerification: true,
      profile,
      regulation,
    };
  }

  if (status === 'PROVISIONALLY_APPROVED') {
    return {
      allowed: false,
      decision: 'BLOCKED_PROVISIONAL_APPROVAL',
      requiresVerification: false,
      profile,
      regulation,
    };
  }

  return {
    allowed: false,
    decision: 'BLOCKED_UNKNOWN_STATUS',
    requiresVerification: false,
    profile,
    regulation,
  };
}
