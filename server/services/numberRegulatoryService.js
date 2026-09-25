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

export function getRegulatorySupportingDocumentRequirements(
  requirements
) {
  const groups =
    requirements &&
    Array.isArray(requirements.supporting_document)
      ? requirements.supporting_document
      : [];

  return groups.map((group) => {
    const entries = Array.isArray(group)
      ? group
      : [group];

    return entries
      .filter(
        (entry) =>
          entry &&
          typeof entry === 'object'
      )
      .map((entry) => ({
        requirementName:
          typeof entry.requirement_name === 'string'
            ? entry.requirement_name
            : null,
        type:
          typeof entry.type === 'string'
            ? entry.type
            : null,
        acceptedDocuments: Array.isArray(
          entry.accepted_documents
        )
          ? entry.accepted_documents
              .filter(
                (document) =>
                  document &&
                  typeof document === 'object'
              )
              .map((document) => ({
                name:
                  typeof document.name === 'string'
                    ? document.name
                    : null,
                type:
                  typeof document.type === 'string'
                    ? document.type
                    : null,
              }))
          : [],
      }));
  });
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

export async function syncRegulatoryBundleStatusBySid({
  bundleSid,
  provider = PROFILE_PROVIDER,
}) {
  const cleanBundleSid = String(
    bundleSid || ''
  ).trim();

  if (!/^BU[a-f0-9]{32}$/i.test(cleanBundleSid)) {
    return {
      profile: null,
      approved: false,
      knownStatus: false,
      reason: 'invalid-bundle-sid',
    };
  }

  const normalizedProvider = String(
    provider || PROFILE_PROVIDER
  )
    .trim()
    .toLowerCase();

  const profile =
    await prisma.numberRegulatoryProfile.findUnique({
      where: {
        bundleSid: cleanBundleSid,
      },
    });

  if (
    !profile ||
    profile.provider !== normalizedProvider
  ) {
    return {
      profile: null,
      approved: false,
      knownStatus: false,
      reason: 'profile-not-found',
    };
  }

  return syncRegulatoryBundleStatus({
    userId: profile.userId,
    provider: profile.provider,
    country: profile.isoCountry,
    numberType: profile.numberType,
    endUserType: profile.endUserType,
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

export async function initializeNumberRegulatoryVerification({
  userId,
  candidate,
  endUserType = 'individual',
  endUserAttributes,
  endUserFriendlyName,
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

  const key = normalizeProfileKey({
    userId,
    provider,
    country,
    numberType,
    endUserType: normalizedEndUserType,
  });

  const api = getProvider(key.provider);

  if (
    !api ||
    typeof api.getRegulations !== 'function'
  ) {
    return {
      initialized: false,
      reason: 'provider-unsupported',
      profile: null,
      regulation: null,
    };
  }

  let regulations;

  try {
    regulations = await api.getRegulations({
      country: key.isoCountry,
      numberType: key.numberType,
      endUserType: key.endUserType,
      includeConstraints: true,
    });
  } catch {
    return {
      initialized: false,
      reason: 'regulation-lookup-failed',
      profile: null,
      regulation: null,
    };
  }

  if (!Array.isArray(regulations)) {
    return {
      initialized: false,
      reason: 'regulation-lookup-failed',
      profile: null,
      regulation: null,
    };
  }

  if (regulations.length === 0) {
    return {
      initialized: false,
      reason: 'regulation-not-required',
      profile: null,
      regulation: null,
    };
  }

  if (regulations.length !== 1) {
    return {
      initialized: false,
      reason: 'ambiguous-regulation',
      profile: null,
      regulation: null,
      regulations,
    };
  }

  const regulation = regulations[0];

  const regulationSid = String(
    regulation?.sid || ''
  ).trim();

  if (!/^RN[a-f0-9]{32}$/i.test(regulationSid)) {
    return {
      initialized: false,
      reason: 'invalid-regulation',
      profile: null,
      regulation,
    };
  }

  const existing =
    await prisma.numberRegulatoryProfile.findUnique({
      where: profileUniqueWhere(key),
    });

  if (existing) {
    if (
      existing.regulationSid &&
      existing.regulationSid !== regulationSid
    ) {
      return {
        initialized: false,
        reason: 'regulation-changed',
        profile: existing,
        regulation,
      };
    }

    let profile =
      existing.regulationSid
        ? existing
        : await prisma.numberRegulatoryProfile.update({
            where: {
              id: existing.id,
            },
            data: {
              regulationSid,
            },
          });

    const shouldProvisionEndUser =
      endUserAttributes !== undefined;

    if (
      shouldProvisionEndUser &&
      !profile.endUserSid
    ) {
      const validation =
        validateRegulatoryEndUserAttributes({
          requirements:
            regulation.requirements || {},
          attributes: endUserAttributes,
        });

      if (!validation.valid) {
        return {
          initialized: false,
          reused: true,
          reason: 'missing-end-user-fields',
          profile,
          regulation,
          requirements:
            regulation.requirements || null,
          validation,
        };
      }

      if (
        !api ||
        typeof api.createRegulatoryEndUser !== 'function'
      ) {
        return {
          initialized: false,
          reused: true,
          reason: 'provider-end-user-unsupported',
          profile,
          regulation,
          requirements:
            regulation.requirements || null,
        };
      }

      let endUser;

      try {
        endUser =
          await api.createRegulatoryEndUser({
            friendlyName:
              String(
                endUserFriendlyName ||
                `Chatforia User ${userId}`
              ).trim(),
            endUserType:
              key.endUserType,
            attributes:
              validation.attributes,
          });
      } catch {
        return {
          initialized: false,
          reused: true,
          reason: 'end-user-creation-failed',
          profile,
          regulation,
          requirements:
            regulation.requirements || null,
        };
      }

      const endUserSid = String(
        endUser?.sid || ''
      ).trim();

      if (!/^IT[a-f0-9]{32}$/i.test(endUserSid)) {
        return {
          initialized: false,
          reused: true,
          reason: 'invalid-end-user',
          profile,
          regulation,
          requirements:
            regulation.requirements || null,
        };
      }

      profile =
        await prisma.numberRegulatoryProfile.update({
          where: {
            id: profile.id,
          },
          data: {
            endUserSid,
          },
        });
    }

    return {
      initialized: true,
      reused: true,
      reason: null,
      profile,
      regulation,
      requirements:
        regulation.requirements || null,
    };
  }

  let profile =
    await prisma.numberRegulatoryProfile.create({
      data: {
        ...key,
        regulationSid,
        status: 'NOT_STARTED',
      },
    });

  const shouldProvisionEndUser =
    endUserAttributes !== undefined;

  if (shouldProvisionEndUser) {
    const validation =
      validateRegulatoryEndUserAttributes({
        requirements:
          regulation.requirements || {},
        attributes: endUserAttributes,
      });

    if (!validation.valid) {
      return {
        initialized: false,
        reused: false,
        reason: 'missing-end-user-fields',
        profile,
        regulation,
        requirements:
          regulation.requirements || null,
        validation,
      };
    }

    if (
      !api ||
      typeof api.createRegulatoryEndUser !== 'function'
    ) {
      return {
        initialized: false,
        reused: false,
        reason: 'provider-end-user-unsupported',
        profile,
        regulation,
        requirements:
          regulation.requirements || null,
      };
    }

    let endUser;

    try {
      endUser =
        await api.createRegulatoryEndUser({
          friendlyName:
            String(
              endUserFriendlyName ||
              `Chatforia User ${userId}`
            ).trim(),
          endUserType:
            key.endUserType,
          attributes:
            validation.attributes,
        });
    } catch {
      return {
        initialized: false,
        reused: false,
        reason: 'end-user-creation-failed',
        profile,
        regulation,
        requirements:
          regulation.requirements || null,
      };
    }

    const endUserSid = String(
      endUser?.sid || ''
    ).trim();

    if (!/^IT[a-f0-9]{32}$/i.test(endUserSid)) {
      return {
        initialized: false,
        reused: false,
        reason: 'invalid-end-user',
        profile,
        regulation,
        requirements:
          regulation.requirements || null,
      };
    }

    profile =
      await prisma.numberRegulatoryProfile.update({
        where: {
          id: profile.id,
        },
        data: {
          endUserSid,
        },
      });
  }

  return {
    initialized: true,
    reused: false,
    reason: null,
    profile,
    regulation,
    requirements:
      regulation.requirements || null,
  };
}


export async function submitNumberRegulatoryBundle({
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
      submitted: false,
      reason: 'profile-not-found',
      profile: null,
    };
  }

  const bundleSid =
    String(profile.bundleSid || '').trim();

  if (!/^BU[a-f0-9]{32}$/i.test(bundleSid)) {
    return {
      submitted: false,
      reason: 'bundle-not-created',
      profile,
    };
  }

  if (profile.status !== 'DRAFT') {
    return {
      submitted: false,
      reason: 'bundle-not-draft',
      profile,
    };
  }

  const regulationSid =
    String(profile.regulationSid || '').trim();

  const endUserSid =
    String(profile.endUserSid || '').trim();

  if (!/^RN[a-f0-9]{32}$/i.test(regulationSid)) {
    return {
      submitted: false,
      reason: 'regulation-not-initialized',
      profile,
    };
  }

  if (!/^IT[a-f0-9]{32}$/i.test(endUserSid)) {
    return {
      submitted: false,
      reason: 'end-user-not-provisioned',
      profile,
    };
  }

  const documents =
    await prisma.numberRegulatoryDocument.findMany({
      where: {
        profileId: profile.id,
      },
    });

  const api = getProvider(key.provider);

  if (
    !api ||
    typeof api.getRegulations !== 'function' ||
    typeof api.listRegulatoryBundleItems !== 'function' ||
    typeof api.submitRegulatoryBundle !== 'function' ||
    typeof api.normalizeRegulatoryBundleStatus !==
      'function'
  ) {
    return {
      submitted: false,
      reason: 'provider-submission-unsupported',
      profile,
    };
  }

  let regulations;

  try {
    regulations =
      await api.getRegulations({
        country: key.isoCountry,
        numberType: key.numberType,
        endUserType: key.endUserType,
        includeConstraints: true,
      });
  } catch {
    return {
      submitted: false,
      reason: 'regulation-lookup-failed',
      profile,
    };
  }

  const matchingRegulations =
    Array.isArray(regulations)
      ? regulations.filter(
          (regulation) =>
            String(regulation?.sid || '').trim() ===
            regulationSid
        )
      : [];

  if (matchingRegulations.length !== 1) {
    return {
      submitted: false,
      reason: 'regulation-not-found',
      profile,
    };
  }

  const requirementGroups =
    getRegulatorySupportingDocumentRequirements(
      matchingRegulations[0].requirements || {}
    );

  const requiredRequirementNames =
    [
      ...new Set(
        requirementGroups
          .flat()
          .map((requirement) =>
            String(
              requirement?.requirementName || ''
            ).trim()
          )
          .filter(Boolean)
      ),
    ];

  const documentsByRequirement =
    new Map(
      documents.map((document) => [
        String(
          document.requirementName || ''
        ).trim(),
        document,
      ])
    );

  const requiredDocuments =
    requiredRequirementNames.map(
      (requirementName) =>
        documentsByRequirement.get(
          requirementName
        )
    );

  const missingRequirementNames =
    requiredRequirementNames.filter(
      (requirementName) => {
        const document =
          documentsByRequirement.get(
            requirementName
          );

        return !/^RD[a-f0-9]{32}$/i.test(
          String(
            document?.supportingDocumentSid || ''
          ).trim()
        );
      }
    );

  if (missingRequirementNames.length > 0) {
    return {
      submitted: false,
      reason: 'supporting-documents-incomplete',
      profile,
      missingRequirementNames,
    };
  }

  const requiredObjectSids = [
    endUserSid,
    ...requiredDocuments.map((document) =>
      String(
        document.supportingDocumentSid
      ).trim()
    ),
  ];

  let assignments;

  try {
    assignments =
      await api.listRegulatoryBundleItems({
        bundleSid,
      });
  } catch {
    return {
      submitted: false,
      reason: 'bundle-assignment-lookup-failed',
      profile,
    };
  }

  const assignedObjectSids =
    new Set(
      (Array.isArray(assignments)
        ? assignments
        : []
      )
        .map((assignment) =>
          String(
            assignment?.objectSid || ''
          ).trim()
        )
        .filter(Boolean)
    );

  const missingObjectSids =
    requiredObjectSids.filter(
      (objectSid) =>
        !assignedObjectSids.has(objectSid)
    );

  if (missingObjectSids.length > 0) {
    return {
      submitted: false,
      reason: 'bundle-incomplete',
      profile,
      missingObjectSids,
    };
  }

  let bundle;

  try {
    bundle =
      await api.submitRegulatoryBundle({
        bundleSid,
      });
  } catch {
    return {
      submitted: false,
      reason: 'bundle-submission-failed',
      profile,
    };
  }

  const providerStatus =
    bundle?.status == null
      ? null
      : String(bundle.status);

  const normalizedStatus =
    bundle?.normalizedStatus ||
    api.normalizeRegulatoryBundleStatus(
      providerStatus
    );

  if (normalizedStatus !== 'PENDING_REVIEW') {
    return {
      submitted: false,
      reason: 'unexpected-submission-status',
      profile,
      providerStatus,
    };
  }

  const now = new Date();

  const updated =
    await prisma.numberRegulatoryProfile.update({
      where: {
        id: profile.id,
      },
      data: {
        status: 'PENDING_REVIEW',
        providerStatus,
        submittedAt:
          profile.submittedAt || now,
        validUntil:
          bundle?.validUntil ??
          profile.validUntil,
        rejectionReason: null,
      },
    });

  return {
    submitted: true,
    reason: null,
    profile: updated,
  };
}

export async function assembleRegulatoryBundle({
  userId,
  provider = PROFILE_PROVIDER,
  country,
  numberType,
  endUserType,
  email,
  friendlyName,
  statusCallback,
}) {
  const key = normalizeProfileKey({
    userId,
    provider,
    country,
    numberType,
    endUserType,
  });

  let profile =
    await prisma.numberRegulatoryProfile.findUnique({
      where: profileUniqueWhere(key),
    });

  if (!profile) {
    return {
      assembled: false,
      reusedBundle: false,
      reason: 'profile-not-found',
      profile: null,
    };
  }

  const regulationSid =
    String(profile.regulationSid || '').trim();

  const endUserSid =
    String(profile.endUserSid || '').trim();

  if (!/^RN[a-f0-9]{32}$/i.test(regulationSid)) {
    return {
      assembled: false,
      reusedBundle: false,
      reason: 'regulation-not-initialized',
      profile,
    };
  }

  if (!/^IT[a-f0-9]{32}$/i.test(endUserSid)) {
    return {
      assembled: false,
      reusedBundle: false,
      reason: 'end-user-not-provisioned',
      profile,
    };
  }

  const documents =
    await prisma.numberRegulatoryDocument.findMany({
      where: {
        profileId: profile.id,
      },
    });

  const api = getProvider(key.provider);

  if (
    !api ||
    typeof api.getRegulations !== 'function'
  ) {
    return {
      assembled: false,
      reusedBundle: Boolean(profile.bundleSid),
      reason: 'provider-regulations-unsupported',
      profile,
      documents,
    };
  }

  let regulations;

  try {
    regulations = await api.getRegulations({
      country: key.isoCountry,
      numberType: key.numberType,
      endUserType: key.endUserType,
      includeConstraints: true,
    });
  } catch {
    return {
      assembled: false,
      reusedBundle: Boolean(profile.bundleSid),
      reason: 'regulation-lookup-failed',
      profile,
      documents,
    };
  }

  const matchingRegulations =
    Array.isArray(regulations)
      ? regulations.filter(
          (regulation) =>
            String(regulation?.sid || '').trim() ===
            regulationSid
        )
      : [];

  if (matchingRegulations.length !== 1) {
    return {
      assembled: false,
      reusedBundle: Boolean(profile.bundleSid),
      reason: 'regulation-not-found',
      profile,
      documents,
    };
  }

  const requirementGroups =
    getRegulatorySupportingDocumentRequirements(
      matchingRegulations[0].requirements || {}
    );

  const requiredRequirementNames =
    [
      ...new Set(
        requirementGroups
          .flat()
          .map((requirement) =>
            String(
              requirement?.requirementName || ''
            ).trim()
          )
          .filter(Boolean)
      ),
    ];

  const documentsByRequirement =
    new Map(
      documents.map((document) => [
        String(
          document.requirementName || ''
        ).trim(),
        document,
      ])
    );

  const missingRequirementNames =
    requiredRequirementNames.filter(
      (requirementName) => {
        const document =
          documentsByRequirement.get(
            requirementName
          );

        return !/^RD[a-f0-9]{32}$/i.test(
          String(
            document?.supportingDocumentSid || ''
          ).trim()
        );
      }
    );

  if (missingRequirementNames.length > 0) {
    return {
      assembled: false,
      reusedBundle: Boolean(profile.bundleSid),
      reason: 'supporting-documents-incomplete',
      profile,
      documents,
      missingRequirementNames,
    };
  }

  const requiredDocuments =
    requiredRequirementNames.map(
      (requirementName) =>
        documentsByRequirement.get(
          requirementName
        )
    );

  if (
    !api ||
    typeof api.createRegulatoryBundle !== 'function' ||
    typeof api.listRegulatoryBundleItems !== 'function' ||
    typeof api.assignRegulatoryItem !== 'function'
  ) {
    return {
      assembled: false,
      reusedBundle: Boolean(profile.bundleSid),
      reason: 'provider-bundle-unsupported',
      profile,
      documents,
    };
  }

  let bundleSid =
    String(profile.bundleSid || '').trim();

  let reusedBundle = Boolean(bundleSid);

  if (bundleSid) {
    if (!/^BU[a-f0-9]{32}$/i.test(bundleSid)) {
      return {
        assembled: false,
        reusedBundle: true,
        reason: 'invalid-bundle',
        profile,
        documents,
      };
    }
  } else {
    let bundle;

    try {
      bundle =
        await api.createRegulatoryBundle({
          friendlyName:
            String(
              friendlyName ||
              `Chatforia ${key.isoCountry} ${key.numberType} ${key.userId}`
            ).trim(),
          email:
            String(email || '').trim(),
          regulationSid,
          country: key.isoCountry,
          numberType: key.numberType,
          endUserType: key.endUserType,
          statusCallback,
        });
    } catch {
      return {
        assembled: false,
        reusedBundle: false,
        reason: 'bundle-creation-failed',
        profile,
        documents,
      };
    }

    bundleSid =
      String(bundle?.sid || '').trim();

    if (!/^BU[a-f0-9]{32}$/i.test(bundleSid)) {
      return {
        assembled: false,
        reusedBundle: false,
        reason: 'invalid-bundle',
        profile,
        documents,
      };
    }

    try {
      profile =
        await prisma.numberRegulatoryProfile.update({
          where: {
            id: profile.id,
          },
          data: {
            bundleSid,
            status: 'DRAFT',
            providerStatus:
              bundle.status || 'draft',
            validUntil:
              bundle.validUntil || null,
          },
        });
    } catch {
      return {
        assembled: false,
        reusedBundle: false,
        reason: 'bundle-persistence-failed',
        profile,
        documents,
        bundleSid,
      };
    }
  }

  let assignments;

  try {
    assignments =
      await api.listRegulatoryBundleItems({
        bundleSid,
      });
  } catch {
    return {
      assembled: false,
      reusedBundle,
      reason: 'bundle-assignment-lookup-failed',
      profile,
      documents,
      bundleSid,
    };
  }

  const assignedObjectSids =
    new Set(
      (Array.isArray(assignments)
        ? assignments
        : []
      )
        .map((assignment) =>
          String(
            assignment?.objectSid || ''
          ).trim()
        )
        .filter(Boolean)
    );

  const requiredObjectSids = [
    endUserSid,
    ...requiredDocuments.map((document) =>
      String(
        document.supportingDocumentSid
      ).trim()
    ),
  ];

  const assignedNow = [];
  const alreadyAssigned = [];

  for (const objectSid of requiredObjectSids) {
    if (assignedObjectSids.has(objectSid)) {
      alreadyAssigned.push(objectSid);
      continue;
    }

    try {
      await api.assignRegulatoryItem({
        bundleSid,
        objectSid,
      });
    } catch {
      return {
        assembled: false,
        reusedBundle,
        reason: 'bundle-item-assignment-failed',
        profile,
        documents,
        bundleSid,
        failedObjectSid: objectSid,
        assignedNow,
        alreadyAssigned,
      };
    }

    assignedObjectSids.add(objectSid);
    assignedNow.push(objectSid);
  }

  return {
    assembled: true,
    reusedBundle,
    reason: null,
    profile,
    documents,
    bundleSid,
    assignedNow,
    alreadyAssigned,
  };
}

export async function provisionRegulatorySupportingDocument({
  userId,
  provider = PROFILE_PROVIDER,
  country,
  numberType,
  endUserType,
  requirementName,
  documentType,
  attributes,
  friendlyName,
}) {
  const key = normalizeProfileKey({
    userId,
    provider,
    country,
    numberType,
    endUserType,
  });

  const cleanRequirementName =
    String(requirementName || '').trim();

  const cleanDocumentType =
    String(documentType || '').trim();

  if (!cleanRequirementName) {
    throw new Error('requirementName is required');
  }

  if (!cleanDocumentType) {
    throw new Error('documentType is required');
  }

  const profile =
    await prisma.numberRegulatoryProfile.findUnique({
      where: profileUniqueWhere(key),
    });

  if (!profile) {
    return {
      provisioned: false,
      reused: false,
      reason: 'profile-not-found',
      document: null,
    };
  }

  if (!profile.regulationSid) {
    return {
      provisioned: false,
      reused: false,
      reason: 'regulation-not-initialized',
      document: null,
    };
  }

  const api = getProvider(key.provider);

  if (
    !api ||
    typeof api.getRegulations !== 'function'
  ) {
    return {
      provisioned: false,
      reused: false,
      reason: 'provider-regulations-unsupported',
      document: null,
    };
  }

  let regulations;

  try {
    regulations = await api.getRegulations({
      country: key.isoCountry,
      numberType: key.numberType,
      endUserType: key.endUserType,
      includeConstraints: true,
    });
  } catch {
    return {
      provisioned: false,
      reused: false,
      reason: 'regulation-lookup-failed',
      document: null,
    };
  }

  const matchingRegulations =
    Array.isArray(regulations)
      ? regulations.filter(
          (regulation) =>
            String(regulation?.sid || '').trim() ===
            String(profile.regulationSid).trim()
        )
      : [];

  if (matchingRegulations.length !== 1) {
    return {
      provisioned: false,
      reused: false,
      reason: 'regulation-not-found',
      document: null,
    };
  }

  const regulation = matchingRegulations[0];

  const groups =
    getRegulatorySupportingDocumentRequirements(
      regulation.requirements || {}
    );

  const matchingRequirements =
    groups
      .flat()
      .filter(
        (requirement) =>
          requirement.requirementName ===
          cleanRequirementName
      );

  if (matchingRequirements.length !== 1) {
    return {
      provisioned: false,
      reused: false,
      reason: 'supporting-document-requirement-not-found',
      document: null,
    };
  }

  const requirement = matchingRequirements[0];

  const acceptedDocument =
    requirement.acceptedDocuments.find(
      (document) =>
        document.type === cleanDocumentType
    );

  if (!acceptedDocument) {
    return {
      provisioned: false,
      reused: false,
      reason: 'unsupported-supporting-document-type',
      document: null,
      requirement,
    };
  }

  const existing =
    await prisma.numberRegulatoryDocument.findUnique({
      where: {
        profileId_requirementName: {
          profileId: profile.id,
          requirementName: cleanRequirementName,
        },
      },
    });

  if (existing?.supportingDocumentSid) {
    return {
      provisioned: true,
      reused: true,
      reason: null,
      document: existing,
      requirement,
    };
  }

  if (
    !api ||
    typeof api.createRegulatorySupportingDocument !==
      'function'
  ) {
    return {
      provisioned: false,
      reused: false,
      reason: 'provider-supporting-document-unsupported',
      document: existing || null,
      requirement,
    };
  }

  let supportingDocument;

  try {
    supportingDocument =
      await api.createRegulatorySupportingDocument({
        friendlyName:
          String(
            friendlyName ||
            `Chatforia ${key.isoCountry} ${cleanRequirementName}`
          ).trim(),
        type: cleanDocumentType,
        attributes,
      });
  } catch {
    return {
      provisioned: false,
      reused: false,
      reason: 'supporting-document-creation-failed',
      document: existing || null,
      requirement,
    };
  }

  const supportingDocumentSid =
    String(
      supportingDocument?.sid || ''
    ).trim();

  if (
    !/^RD[a-f0-9]{32}$/i.test(
      supportingDocumentSid
    )
  ) {
    return {
      provisioned: false,
      reused: false,
      reason: 'invalid-supporting-document',
      document: existing || null,
      requirement,
    };
  }

  const document =
    await prisma.numberRegulatoryDocument.upsert({
      where: {
        profileId_requirementName: {
          profileId: profile.id,
          requirementName: cleanRequirementName,
        },
      },
      create: {
        profileId: profile.id,
        requirementName: cleanRequirementName,
        documentType: cleanDocumentType,
        supportingDocumentSid,
        providerStatus:
          supportingDocument.status || null,
        failureReason:
          supportingDocument.failureReason || null,
      },
      update: {
        documentType: cleanDocumentType,
        supportingDocumentSid,
        providerStatus:
          supportingDocument.status || null,
        failureReason:
          supportingDocument.failureReason || null,
      },
    });

  return {
    provisioned: true,
    reused: false,
    reason: null,
    document,
    requirement,
  };
}

function isPresentRegulatoryValue(value) {
  if (value === null || value === undefined) {
    return false;
  }

  if (typeof value === 'string') {
    return value.trim().length > 0;
  }

  return true;
}

export function getRequiredRegulatoryEndUserFields(
  requirements
) {
  const endUserRequirements =
    requirements?.end_user;

  if (!Array.isArray(endUserRequirements)) {
    return [];
  }

  const fields = [];

  for (const requirement of endUserRequirements) {
    if (!Array.isArray(requirement?.fields)) {
      continue;
    }

    for (const field of requirement.fields) {
      const normalized = String(field || '').trim();

      if (
        normalized &&
        !fields.includes(normalized)
      ) {
        fields.push(normalized);
      }
    }
  }

  return fields;
}

export function validateRegulatoryEndUserAttributes({
  requirements,
  attributes,
}) {
  const requiredFields =
    getRequiredRegulatoryEndUserFields(
      requirements
    );

  const submitted =
    attributes &&
    typeof attributes === 'object' &&
    !Array.isArray(attributes)
      ? attributes
      : {};

  const missingFields =
    requiredFields.filter(
      (field) =>
        !isPresentRegulatoryValue(
          submitted[field]
        )
    );

  const normalizedAttributes = {};

  for (const field of requiredFields) {
    if (
      isPresentRegulatoryValue(
        submitted[field]
      )
    ) {
      normalizedAttributes[field] =
        typeof submitted[field] === 'string'
          ? submitted[field].trim()
          : submitted[field];
    }
  }

  return {
    valid: missingFields.length === 0,
    requiredFields,
    missingFields,
    attributes: normalizedAttributes,
  };
}
