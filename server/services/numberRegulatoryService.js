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
