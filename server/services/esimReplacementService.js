import prisma from '../utils/prismaClient.js';
import * as esimProvider from './providers/esimProvider.js';
import { createSubscriberWithAllocatedEsim } from './esimAllocation.js';

const FINITE_PACKS_GB = [3, 5, 10, 20];

function makeError(message, code) {
  const err = new Error(message);
  err.code = code;
  return err;
}

function normalizeIdempotencyKey(value) {
  const normalized =
    String(value || '').trim();

  if (
    !normalized ||
    normalized.length > 200
  ) {
    throw makeError(
      'A valid idempotencyKey is required',
      'ESIM_REPLACEMENT_INVALID_IDEMPOTENCY_KEY'
    );
  }

  return normalized;
}

async function findReplacementByIdempotencyKey({
  prismaClient,
  userId,
  idempotencyKey,
}) {
  return prismaClient.esimReplacement.findUnique({
    where: {
      userId_idempotencyKey: {
        userId,
        idempotencyKey,
      },
    },
    include: {
      newSubscriber: true,
      oldSubscriber: true,
    },
  });
}

function p2002TargetIncludes(
  err,
  field
) {
  if (err?.code !== 'P2002') {
    return false;
  }

  const target = err?.meta?.target;

  if (Array.isArray(target)) {
    return target.includes(field);
  }

  return String(target || '').includes(
    field
  );
}

function isIdempotencyKeyCollision(err) {
  return (
    p2002TargetIncludes(err, 'userId') &&
    p2002TargetIncludes(
      err,
      'idempotencyKey'
    )
  );
}

function isOldProviderPurchaseIdCollision(err) {
  return p2002TargetIncludes(
    err,
    'oldProviderPurchaseId'
  );
}

function isAmbiguousProvisioningError(err) {
  const status = Number(err?.status);

  /*
   * A 4xx response is a definite provider rejection.
   * A 5xx response may have occurred after package creation crossed
   * the provider side-effect boundary.
   */
  if (Number.isInteger(status)) {
    return status >= 500;
  }

  /*
   * Telna returned success to the package-creation POST but did not
   * provide the package identifier required to track the result.
   */
  if (err?.code === 'TELNA_PACKAGE_ID_MISSING') {
    return true;
  }

  /*
   * These errors occur before the package-creation POST is sent, so
   * they are definite failures rather than ambiguous provider state.
   */
  const definitePreRequestCodes = new Set([
    'ESIM_INVALID_PARAMS',
    'ESIM_INVALID_USERID',
    'ESIM_INVALID_PROVIDER_PROFILE_ID',
    'ESIM_INVALID_ICCID',
    'ESIM_INVALID_ADDON_KIND',
    'ESIM_INVALID_PLAN_CODE',
    'ESIM_INVALID_TIME_ALLOWANCE',
    'TELNA_INVALID_PROVISION_PARAMS',
    'TELNA_MISSING_ICCID',
    'TELNA_PACKAGE_TEMPLATE_NOT_CONFIGURED',
    'TELNA_INVALID_TIME_ALLOWANCE',
    'TELNA_NOT_CONFIGURED',
  ]);

  if (definitePreRequestCodes.has(err?.code)) {
    return false;
  }

  /*
   * telnaRequest attaches a Request-ID once a request reaches the
   * Telna HTTP layer. With no HTTP status, the provider outcome is
   * uncertain: timeout, connection reset, DNS/network failure, etc.
   */
  return Boolean(err?.requestId);
}

function normalizeScope(addonKind) {
  const value = String(addonKind || '').toLowerCase();

  if (value.includes('_local_')) return 'local';
  if (value.includes('_europe_')) return 'europe';
  if (value.includes('_global_')) return 'global';

  return null;
}

function replacementAddonKind(scope, gb) {
  return `chatforia_esim_${scope}_${gb}_premium`;
}

/*
 * Select the smallest existing finite package that can contain the
 * customer's authoritative remaining balance.
 *
 * remainingDataMb is intentionally rounded UP before comparison so a
 * fractional Telna MB can never be lost.
 */
export function chooseReplacementPack(
  addonKind,
  remainingDataMb
) {
  const scope = normalizeScope(addonKind);

  if (!scope) {
    throw makeError(
      'Unable to determine eSIM package scope',
      'ESIM_REPLACEMENT_UNKNOWN_SCOPE'
    );
  }

  if (
    String(addonKind || '')
      .toLowerCase()
      .includes('_unlimited_')
  ) {
    throw makeError(
      'Unlimited eSIM replacement is not supported yet',
      'ESIM_REPLACEMENT_UNLIMITED_UNSUPPORTED'
    );
  }

  if (
    typeof remainingDataMb !== 'number' ||
    !Number.isFinite(remainingDataMb) ||
    remainingDataMb < 0
  ) {
    throw makeError(
      'Replacement requires a valid remaining data balance',
      'ESIM_REPLACEMENT_INVALID_BALANCE'
    );
  }

  /*
   * A device replacement preserves the customer's remaining
   * entitlement. It must never replenish an exhausted package.
   */
  if (remainingDataMb === 0) {
    throw makeError(
      'The eSIM package has no remaining data to transfer',
      'ESIM_REPLACEMENT_EXHAUSTED'
    );
  }

  const requiredMb = Math.ceil(remainingDataMb);

  /*
   * Global 20 GB is not currently present in billingProducts.js.
   * Do not invent a package that the canonical billing configuration
   * does not expose.
   */
  const availableGb =
    scope === 'global'
      ? FINITE_PACKS_GB.filter((gb) => gb <= 10)
      : FINITE_PACKS_GB;

  const selectedGb = availableGb.find(
    (gb) => requiredMb <= gb * 1024
  );

  if (!selectedGb) {
    throw makeError(
      'No configured replacement package can cover the remaining balance',
      'ESIM_REPLACEMENT_NO_CAPACITY'
    );
  }

  return {
    scope,
    replacementDataMb: selectedGb * 1024,
    replacementAddonKind:
      replacementAddonKind(scope, selectedGb),
  };
}

function remainingValiditySeconds(expiresAt, now) {
  if (!expiresAt) {
    throw makeError(
      'Replacement requires an expiration date',
      'ESIM_REPLACEMENT_MISSING_EXPIRY'
    );
  }

  const expiry = new Date(expiresAt);

  if (Number.isNaN(expiry.getTime())) {
    throw makeError(
      'Replacement expiration date is invalid',
      'ESIM_REPLACEMENT_INVALID_EXPIRY'
    );
  }

  const milliseconds =
    expiry.getTime() - now.getTime();

  if (milliseconds <= 0) {
    throw makeError(
      'The eSIM package has already expired',
      'ESIM_REPLACEMENT_EXPIRED'
    );
  }

  return Math.ceil(milliseconds / 1000);
}

async function resolveOldSubscriber({
  prismaClient,
  userId,
  purchase,
}) {
  const conditions = [];

  if (purchase.iccid) {
    conditions.push({
      iccid: purchase.iccid,
    });
  }

  if (purchase.esimProfileId) {
    conditions.push({
      providerProfileId:
        purchase.esimProfileId,
    });
  }

  if (!conditions.length) {
    throw makeError(
      'The existing eSIM has no subscriber identity',
      'ESIM_REPLACEMENT_MISSING_SUBSCRIBER_IDENTITY'
    );
  }

  const subscriber =
    await prismaClient.subscriber.findFirst({
      where: {
        userId: Number(userId),
        OR: conditions,
      },
      orderBy: [
        { activatedAt: 'desc' },
        { createdAt: 'desc' },
      ],
    });

  if (!subscriber) {
    throw makeError(
      'Existing eSIM subscriber was not found',
      'ESIM_REPLACEMENT_SUBSCRIBER_NOT_FOUND'
    );
  }

  return subscriber;
}

/*
 * Atomically make a known replacement package canonical in Chatforia.
 *
 * The provider package MUST already exist before this helper is called.
 * Successful completion is recorded by provisionedAt. Until that
 * timestamp is committed, old-service cleanup is forbidden.
 */
async function persistProvisionedReplacement({
  prismaClient,
  replacement,
  newSubscriber,
  oldSubscriber,
  purchaseId,
  userId,
  oldIccid,
  providerPack,
  providerProfileId,
  remainingDataMb,
  expiresAt,
}) {
  if (
    !providerPack?.providerPurchaseId ||
    !newSubscriber?.id ||
    !newSubscriber?.iccid
  ) {
    throw makeError(
      'Known replacement package is missing canonical persistence data',
      'ESIM_REPLACEMENT_CANONICAL_DATA_MISSING'
    );
  }

  const canonicalIccid =
    providerPack.iccid ||
    newSubscriber.iccid;

  const canonicalProfileId =
    newSubscriber.providerProfileId ||
    providerProfileId ||
    null;

  await prismaClient.$transaction(
    async (tx) => {
      await tx.esimReplacement.update({
        where: {
          id: replacement.id,
        },
        data: {
          newSubscriberId:
            newSubscriber.id,
          newIccid:
            canonicalIccid,
          newProviderProfileId:
            canonicalProfileId,
          newProviderPurchaseId:
            String(
              providerPack.providerPurchaseId
            ),
          status: 'PROVISIONED',
          provisionedAt:
            new Date(),
          errorCode: null,
          errorMessage: null,
        },
      });

      await tx.subscriber.update({
        where: {
          id: newSubscriber.id,
        },
        data: {
          providerProfileId:
            canonicalProfileId,
          iccid:
            canonicalIccid,
          expiresAt:
            providerPack.expiresAt ||
            expiresAt,
          /*
           * The replacement package exists, but installation/activation
           * on the new device may not have happened yet.
           */
          status: 'PROVISIONING',
          providerMeta: {
            ...(
              newSubscriber.providerMeta ||
              {}
            ),
            replacement: {
              replacementId:
                replacement.id,
              oldSubscriberId:
                oldSubscriber.id,
              oldIccid,
              providerPack,
            },
          },
        },
      });

      await tx.mobileDataPackPurchase.update({
        where: {
          id: Number(purchaseId),
        },
        data: {
          remainingDataMb,
          expiresAt,
          iccid:
            canonicalIccid,
          esimProfileId:
            canonicalProfileId,
          providerPurchaseId:
            String(
              providerPack.providerPurchaseId
            ),
          /*
           * Never inherit the old eSIM QR. Telna installation
           * credentials live on the newly allocated Subscriber.
           */
          qrCodeSvg:
            providerPack.qrCodeSvg ||
            null,
          provisioningError:
            null,
        },
      });

      await tx.user.update({
        where: {
          id: Number(userId),
        },
        data: {
          iccid:
            canonicalIccid,
        },
      });
    }
  );
}

/*
 * Complete cleanup of the OLD eSIM only after the replacement package
 * is known to exist and Chatforia's canonical entitlement points at it.
 *
 * This helper NEVER provisions or allocates replacement service.
 * Callers remain responsible for recording REQUIRES_RECONCILIATION
 * if any cleanup step fails.
 */
async function completeOldEsimCleanup({
  prismaClient,
  provider,
  replacement,
  oldSubscriber,
  oldProviderPurchaseId,
  oldProviderProfileId,
  oldIccid,
  testMode = false,
}) {
  if (!replacement.oldPackageTerminatedAt) {
    await provider.setEsimPackageStatus(
      oldProviderPurchaseId,
      'TERMINATED'
    );

    await prismaClient.esimReplacement.update({
      where: {
        id: replacement.id,
      },
      data: {
        status: 'OLD_PACKAGE_TERMINATED',
        oldPackageTerminatedAt:
          new Date(),
      },
    });
  }

  await provider.suspendLine({
    providerProfileId:
      oldSubscriber.providerProfileId ||
      oldProviderProfileId ||
      oldIccid,
    iccid:
      oldIccid,
    testMode,
  });

  /*
   * Canonical service already points at the replacement. This
   * transaction only records successful cleanup of the old SIM and
   * completes the replacement audit.
   */
  await prismaClient.$transaction(
    async (tx) => {
      await tx.subscriber.update({
        where: {
          id: oldSubscriber.id,
        },
        data: {
          status: 'SUSPENDED',
          suspendedAt:
            new Date(),
        },
      });

      await tx.esimReplacement.update({
        where: {
          id: replacement.id,
        },
        data: {
          status: 'COMPLETED',
          completedAt:
            new Date(),
          errorCode: null,
          errorMessage: null,
        },
      });
    }
  );
}

export async function replaceEsimForDevice(
  {
    userId,
    purchaseId,
    idempotencyKey,
    reason = 'DEVICE_REPLACEMENT',
    testMode = false,
    now = new Date(),
  },
  {
    prismaClient = prisma,
    provider = esimProvider,
    allocator =
      createSubscriberWithAllocatedEsim,
  } = {}
) {
  const normalizedUserId = Number(userId);
  const normalizedPurchaseId =
    Number(purchaseId);

  if (
    !Number.isInteger(normalizedUserId) ||
    normalizedUserId <= 0
  ) {
    throw makeError(
      'A valid userId is required',
      'ESIM_REPLACEMENT_INVALID_USER'
    );
  }

  if (
    !Number.isInteger(normalizedPurchaseId) ||
    normalizedPurchaseId <= 0
  ) {
    throw makeError(
      'A valid purchaseId is required',
      'ESIM_REPLACEMENT_INVALID_PURCHASE'
    );
  }

  const normalizedIdempotencyKey =
    normalizeIdempotencyKey(
      idempotencyKey
    );

  /*
   * Detect a retry BEFORE reading the mutable purchase or making any
   * provider call. A completed replacement changes the purchase's
   * provider package/ICCID, so replay detection must happen first.
   */
  const existingByRequest =
    await findReplacementByIdempotencyKey({
      prismaClient,
      userId:
        normalizedUserId,
      idempotencyKey:
        normalizedIdempotencyKey,
    });

  if (existingByRequest) {
    /*
     * An idempotency key belongs to one purchase for this user.
     * Reusing it for another purchase is a client conflict.
     */
    if (
      existingByRequest.purchaseId !==
      normalizedPurchaseId
    ) {
      throw makeError(
        'Idempotency key was already used for another eSIM purchase',
        'ESIM_REPLACEMENT_IDEMPOTENCY_CONFLICT'
      );
    }

    return existingByRequest;
  }

  /*
   * Ownership is enforced in the query itself. A caller cannot replace
   * another user's purchased eSIM by guessing a purchase ID.
   */
  const purchase =
    await prismaClient.mobileDataPackPurchase.findFirst({
      where: {
        id: normalizedPurchaseId,
        userId: normalizedUserId,
      },
    });

  if (!purchase) {
    throw makeError(
      'Active eSIM purchase was not found',
      'ESIM_REPLACEMENT_PURCHASE_NOT_FOUND'
    );
  }

  if (!purchase.providerPurchaseId) {
    throw makeError(
      'The existing eSIM has no provider package identifier',
      'ESIM_REPLACEMENT_MISSING_PACKAGE'
    );
  }

  if (!purchase.iccid) {
    throw makeError(
      'The existing eSIM has no ICCID',
      'ESIM_REPLACEMENT_MISSING_ICCID'
    );
  }

  const oldSubscriber =
    await resolveOldSubscriber({
      prismaClient,
      userId: normalizedUserId,
      purchase,
    });

  /*
   * Ask Telna for the authoritative balance immediately before moving
   * the entitlement. Never use a stale locally cached balance here.
   */
  const usage =
    await provider.fetchEsimUsage(
      purchase.providerPurchaseId
    );

  if (
    typeof usage?.remainingMb !== 'number' ||
    !Number.isFinite(usage.remainingMb) ||
    usage.remainingMb < 0
  ) {
    throw makeError(
      'Provider did not return a valid remaining data balance',
      'ESIM_REPLACEMENT_USAGE_UNAVAILABLE'
    );
  }

  const authoritativeRemainingMb =
    Math.ceil(usage.remainingMb);

  const authoritativeExpiresAt =
    usage.expiresAt ||
    purchase.expiresAt;

  const timeAllowance =
    remainingValiditySeconds(
      authoritativeExpiresAt,
      now
    );

  const replacementPack =
    chooseReplacementPack(
      purchase.addonKind,
      usage.remainingMb
    );

  /*
   * This record is written BEFORE consuming a new ICCID so every
   * attempted replacement has an audit trail.
   */
  let replacement;

  try {
    replacement =
      await prismaClient.esimReplacement.create({
        data: {
          userId: normalizedUserId,
          purchaseId:
            normalizedPurchaseId,
          idempotencyKey:
            normalizedIdempotencyKey,
          oldSubscriberId:
            oldSubscriber.id,
          oldIccid:
            purchase.iccid,
          oldProviderProfileId:
            oldSubscriber.providerProfileId ||
            purchase.esimProfileId ||
            null,
          oldProviderPurchaseId:
            String(
              purchase.providerPurchaseId
            ),
          remainingDataMb:
            authoritativeRemainingMb,
          originalExpiresAt:
            authoritativeExpiresAt,
          replacementDataMb:
            replacementPack.replacementDataMb,
          replacementAddonKind:
            replacementPack.replacementAddonKind,
          reason:
            String(
              reason ||
              'DEVICE_REPLACEMENT'
            ),
          status: 'PENDING',
        },
      });
  } catch (err) {
    if (isIdempotencyKeyCollision(err)) {
      const existing =
        await findReplacementByIdempotencyKey({
          prismaClient,
          userId:
            normalizedUserId,
          idempotencyKey:
            normalizedIdempotencyKey,
        });

      if (!existing) {
        throw makeError(
          'Idempotency collision detected but the existing workflow could not be loaded',
          'ESIM_REPLACEMENT_COLLISION_UNRESOLVED'
        );
      }

      if (
        existing.purchaseId !==
        normalizedPurchaseId
      ) {
        throw makeError(
          'Idempotency key was already used for another eSIM purchase',
          'ESIM_REPLACEMENT_IDEMPOTENCY_CONFLICT'
        );
      }

      /*
       * The winning request owns all provider work. Exit before
       * allocating another ICCID or provisioning another package.
       */
      return existing;
    }

    if (
      !isOldProviderPurchaseIdCollision(err)
    ) {
      throw err;
    }

    /*
     * Another request won the database race for this provider
     * package. Return that workflow exactly as it currently exists.
     *
     * Critically, this branch exits BEFORE allocating another ICCID
     * or provisioning another package.
     */
    const existing =
      await prismaClient.esimReplacement.findUnique({
        where: {
          oldProviderPurchaseId:
            String(
              purchase.providerPurchaseId
            ),
        },
        include: {
          newSubscriber: true,
          oldSubscriber: true,
        },
      });

    if (!existing) {
      throw makeError(
        'Replacement collision detected but the existing workflow could not be loaded',
        'ESIM_REPLACEMENT_COLLISION_UNRESOLVED'
      );
    }

    return existing;
  }

  let allocation = null;
  let providerPack = null;

  try {
    allocation =
      await allocator(
        {
          userId: normalizedUserId,
          purchaseId:
            normalizedPurchaseId,
          region:
            oldSubscriber.region ||
            (
              replacementPack.scope ===
              'europe'
                ? 'EU'
                : replacementPack.scope ===
                    'global'
                  ? 'GLOBAL'
                  : 'US'
            ),
          product:
            replacementPack
              .replacementAddonKind,
          addonKind:
            replacementPack
              .replacementAddonKind,
          testMode,
          excludedIccids: [
            purchase.iccid,
          ],
        },
        {
          prismaClient,
          provider,
        }
      );

    const newSubscriber =
      allocation?.subscriber;

    if (
      !newSubscriber?.id ||
      !newSubscriber?.iccid
    ) {
      throw makeError(
        'Replacement eSIM allocation returned no subscriber',
        'ESIM_REPLACEMENT_ALLOCATION_FAILED'
      );
    }

    /*
     * Persist the locally claimed replacement eSIM BEFORE attempting
     * external package creation.
     *
     * Telna reserveEsimProfile is discovery-only. Once Chatforia has
     * claimed the ICCID through Subscriber.iccid, this audit linkage
     * lets a definite provisioning failure safely retry against the
     * same Subscriber/ICCID instead of consuming another one.
     */
    await prismaClient.esimReplacement.update({
      where: {
        id: replacement.id,
      },
      data: {
        newSubscriberId:
          newSubscriber.id,
        newIccid:
          newSubscriber.iccid,
        newProviderProfileId:
          newSubscriber.providerProfileId ||
          allocation.providerProfileId ||
          null,
        status: 'ALLOCATED',
        errorCode: null,
        errorMessage: null,
      },
    });

    providerPack =
      await provider.provisionEsimPack({
        userId:
          normalizedUserId,
        providerProfileId:
          allocation.providerProfileId ||
          newSubscriber.providerProfileId,
        iccid:
          newSubscriber.iccid,
        addonKind:
          replacementPack
            .replacementAddonKind,
        planCode:
          replacementPack
            .replacementAddonKind,
        timeAllowance,
        testMode,
      });

    if (
      !providerPack?.providerPurchaseId
    ) {
      throw makeError(
        'Replacement package provisioning returned no package identifier',
        'ESIM_REPLACEMENT_PROVISION_FAILED'
      );
    }

    /*
     * The provider package now definitely exists.
     *
     * Checkpoint its identity OUTSIDE the canonical transaction first.
     * If canonical persistence fails afterward, recovery can distinguish
     * a known provider package from an ambiguous package-creation POST.
     *
     * Do NOT set provisionedAt here. That timestamp remains the durable
     * signal that canonical Chatforia persistence completed.
     */
    await prismaClient.esimReplacement.update({
      where: {
        id: replacement.id,
      },
      data: {
        newSubscriberId:
          newSubscriber.id,
        newIccid:
          providerPack.iccid ||
          newSubscriber.iccid,
        newProviderProfileId:
          newSubscriber.providerProfileId ||
          allocation.providerProfileId ||
          null,
        newProviderPurchaseId:
          String(
            providerPack.providerPurchaseId
          ),
      },
    });

    /*
     * Provisioning succeeded externally and its provider identity is
     * durably checkpointed. Now atomically switch Chatforia's canonical
     * entitlement to the replacement service.
     */
    await persistProvisionedReplacement({
      prismaClient,
      replacement,
      newSubscriber,
      oldSubscriber,
      purchaseId:
        normalizedPurchaseId,
      userId:
        normalizedUserId,
      oldIccid:
        purchase.iccid,
      providerPack,
      providerProfileId:
        allocation.providerProfileId,
      remainingDataMb:
        authoritativeRemainingMb,
      expiresAt:
        authoritativeExpiresAt,
    });
  } catch (err) {
    /*
     * If the provider already returned a package identifier, preserve
     * that identity again in this catch-path write. This is especially
     * important when the dedicated provider checkpoint itself failed.
     *
     * We already know the package exists, so the workflow must remain
     * REQUIRES_RECONCILIATION and must never provision another package.
     */
    const knownProviderPackage =
      providerPack?.providerPurchaseId
        ? String(
            providerPack.providerPurchaseId
          )
        : null;

    await prismaClient.esimReplacement.update({
      where: {
        id: replacement.id,
      },
      data: {
        status:
          knownProviderPackage ||
          isAmbiguousProvisioningError(err)
            ? 'REQUIRES_RECONCILIATION'
            : 'FAILED',

        ...(
          knownProviderPackage
            ? {
                /*
                 * Subscriber/ICCID/profile identity was already durably
                 * stored by the ALLOCATED checkpoint before provisioning.
                 * The critical value that may have failed to checkpoint
                 * after provider success is the provider package ID.
                 */
                newProviderPurchaseId:
                  knownProviderPackage,

                /*
                 * If the provider returned an ICCID, preserve it too.
                 * Do not reference try-scoped allocation variables here.
                 */
                ...(
                  providerPack?.iccid
                    ? {
                        newIccid:
                          providerPack.iccid,
                      }
                    : {}
                ),
              }
            : {}
        ),

        errorCode:
          err?.code ||
          'ESIM_REPLACEMENT_PROVISION_FAILED',
        errorMessage:
          String(
            err?.message ||
            'Replacement provisioning failed'
          ),
      },
    });

    throw err;
  }

  /*
   * From this point forward the NEW package exists. Failure during
   * cleanup must NEVER cause us to terminate or discard that new
   * customer service.
   */
  try {
    await completeOldEsimCleanup({
      prismaClient,
      provider,
      replacement,
      oldSubscriber,
      oldProviderPurchaseId:
        purchase.providerPurchaseId,
      oldProviderProfileId:
        purchase.esimProfileId,
      oldIccid:
        purchase.iccid,
      testMode,
    });
  } catch (err) {
    await prismaClient.esimReplacement.update({
      where: {
        id: replacement.id,
      },
      data: {
        status:
          'REQUIRES_RECONCILIATION',
        errorCode:
          err?.code ||
          'ESIM_REPLACEMENT_CLEANUP_FAILED',
        errorMessage:
          String(
            err?.message ||
            'Old eSIM cleanup failed'
          ),
      },
    });

    throw err;
  }

  return prismaClient.esimReplacement.findUnique({
    where: {
      id: replacement.id,
    },
    include: {
      newSubscriber: true,
      oldSubscriber: true,
    },
  });
}


/**
 * Resume only the safe cleanup portion of an eSIM replacement.
 *
 * This MUST NOT provision another package or allocate another ICCID.
 * If the replacement package outcome is unknown, reconciliation
 * remains fail-closed until the provider can authoritatively resolve it.
 */
/**
 * Claim a definite FAILED eSIM replacement for an explicit retry.
 *
 * This path is intentionally separate from reconciliation:
 *
 * - FAILED means the provider operation definitely did not create a
 *   replacement package and may therefore be retried.
 * - REQUIRES_RECONCILIATION means provider outcome is ambiguous or a
 *   known package already exists and MUST NOT be provisioned again.
 *
 * A retry reuses the Subscriber/ICCID already recorded by the original
 * replacement attempt. It must never allocate another eSIM.
 */
export async function retryFailedEsimReplacement(
  replacementId,
  {
    prismaClient = prisma,
    provider = esimProvider,
    testMode = false,
    now = new Date(),
  } = {}
) {
  const normalizedId =
    String(replacementId || '').trim();

  if (!normalizedId) {
    throw makeError(
      'A valid replacementId is required',
      'ESIM_REPLACEMENT_INVALID_REPLACEMENT_ID'
    );
  }

  const replacement =
    await prismaClient.esimReplacement.findUnique({
      where: {
        id: normalizedId,
      },
      include: {
        oldSubscriber: true,
        newSubscriber: true,
        purchase: true,
      },
    });

  if (!replacement) {
    throw makeError(
      'eSIM replacement not found',
      'ESIM_REPLACEMENT_NOT_FOUND'
    );
  }

  /*
   * Never route ambiguous/known-provider state through retry.
   * Reconciliation is the only safe recovery path for those states.
   */
  if (
    replacement.status !== 'FAILED'
  ) {
    throw makeError(
      'eSIM replacement is not eligible for a definite-failure retry',
      'ESIM_REPLACEMENT_NOT_RETRYABLE'
    );
  }

  /*
   * A definite provisioning retry must reuse the exact allocation from
   * the original attempt. If allocation never completed, this workflow
   * is not safe for this retry API.
   */
  if (
    !replacement.newSubscriber ||
    !replacement.newSubscriberId ||
    !replacement.newIccid ||
    !replacement.newProviderProfileId
  ) {
    throw makeError(
      'Failed eSIM replacement has no reusable allocated Subscriber',
      'ESIM_REPLACEMENT_RETRY_ALLOCATION_MISSING'
    );
  }

  /*
   * A FAILED row must not already contain a provider package ID.
   * If one exists, package creation crossed the provider side-effect
   * boundary and the workflow belongs in reconciliation instead.
   */
  if (replacement.newProviderPurchaseId) {
    throw makeError(
      'Failed eSIM replacement already has a provider package and cannot be reprovisioned',
      'ESIM_REPLACEMENT_RETRY_PROVIDER_PACKAGE_EXISTS'
    );
  }

  const retryExpiresAt =
    replacement.originalExpiresAt;

  const retryRemainingMb =
    Number(replacement.remainingDataMb);

  const retryDataMb =
    Number(replacement.replacementDataMb);

  const retryAddonKind =
    String(
      replacement.replacementAddonKind ||
      ''
    ).trim();

  if (
    !retryExpiresAt ||
    !Number.isFinite(retryRemainingMb) ||
    retryRemainingMb < 0 ||
    !Number.isFinite(retryDataMb) ||
    retryDataMb <= 0 ||
    !retryAddonKind
  ) {
    throw makeError(
      'Failed eSIM replacement is missing frozen retry entitlement data',
      'ESIM_REPLACEMENT_RETRY_DATA_MISSING'
    );
  }

  /*
   * Validate that the frozen replacement entitlement has not expired
   * before claiming the workflow.
   */
  remainingValiditySeconds(
    retryExpiresAt,
    now
  );

  /*
   * Atomic concurrency gate.
   *
   * Only one caller may transition this workflow from FAILED back to
   * ALLOCATED. The winner will eventually own the provider POST.
   * A loser MUST exit before any provider side effect.
   */
  const claim =
    await prismaClient.esimReplacement.updateMany({
      where: {
        id: replacement.id,
        status: 'FAILED',
      },
      data: {
        status: 'ALLOCATED',
        errorCode: null,
        errorMessage: null,
      },
    });

  if (claim?.count !== 1) {
    throw makeError(
      'eSIM replacement retry was already claimed',
      'ESIM_REPLACEMENT_RETRY_ALREADY_CLAIMED'
    );
  }

  /*
   * The retry winner owns the provider side effect from this point.
   *
   * Reuse the frozen entitlement and the already-recorded allocation.
   * Never refresh old-package usage and never allocate another ICCID.
   */
  const timeAllowance =
    remainingValiditySeconds(
      retryExpiresAt,
      now
    );

  let providerPack = null;

  try {
    providerPack =
      await provider.provisionEsimPack({
        userId:
          replacement.userId,
        providerProfileId:
          replacement.newProviderProfileId,
        iccid:
          replacement.newIccid,
        addonKind:
          retryAddonKind,
        planCode:
          retryAddonKind,
        timeAllowance,
        testMode,
      });

    if (
      !providerPack?.providerPurchaseId
    ) {
      throw makeError(
        'Replacement retry provisioning returned no package identifier',
        'ESIM_REPLACEMENT_PROVISION_FAILED'
      );
    }

    /*
     * The provider package definitely exists. Checkpoint its identity
     * before attempting Chatforia's canonical persistence.
     *
     * Do not set provisionedAt here. persistProvisionedReplacement()
     * owns that durable canonical-completion marker.
     */
    await prismaClient.esimReplacement.update({
      where: {
        id: replacement.id,
      },
      data: {
        newSubscriberId:
          replacement.newSubscriberId,
        newIccid:
          providerPack.iccid ||
          replacement.newIccid,
        newProviderProfileId:
          replacement.newProviderProfileId,
        newProviderPurchaseId:
          String(
            providerPack.providerPurchaseId
          ),
      },
    });

    await persistProvisionedReplacement({
      prismaClient,
      replacement,
      newSubscriber:
        replacement.newSubscriber,
      oldSubscriber:
        replacement.oldSubscriber,
      purchaseId:
        replacement.purchaseId,
      userId:
        replacement.userId,
      oldIccid:
        replacement.oldIccid,
      providerPack,
      providerProfileId:
        replacement.newProviderProfileId,
      remainingDataMb:
        retryRemainingMb,
      expiresAt:
        providerPack.expiresAt ||
        retryExpiresAt,
    });
  } catch (err) {
    const knownProviderPackage =
      providerPack?.providerPurchaseId
        ? String(
            providerPack.providerPurchaseId
          )
        : null;

    /*
     * Preserve known provider identity again in the catch path in case
     * the dedicated checkpoint failed after Telna returned success.
     */
    await prismaClient.esimReplacement.update({
      where: {
        id: replacement.id,
      },
      data: {
        status:
          knownProviderPackage ||
          isAmbiguousProvisioningError(err)
            ? 'REQUIRES_RECONCILIATION'
            : 'FAILED',

        ...(
          knownProviderPackage
            ? {
                newProviderPurchaseId:
                  knownProviderPackage,
                ...(
                  providerPack?.iccid
                    ? {
                        newIccid:
                          providerPack.iccid,
                      }
                    : {}
                ),
              }
            : {}
        ),

        errorCode:
          err?.code ||
          'ESIM_REPLACEMENT_PROVISION_FAILED',
        errorMessage:
          String(
            err?.message ||
            'Replacement retry provisioning failed'
          ),
      },
    });

    throw err;
  }

  /*
   * Canonical persistence is complete. Only now may retry destroy the
   * old service.
   */
  try {
    await completeOldEsimCleanup({
      prismaClient,
      provider,
      replacement,
      oldSubscriber:
        replacement.oldSubscriber,
      oldProviderPurchaseId:
        replacement.oldProviderPurchaseId,
      oldProviderProfileId:
        replacement.oldProviderProfileId,
      oldIccid:
        replacement.oldIccid,
      testMode,
    });
  } catch (err) {
    await prismaClient.esimReplacement.update({
      where: {
        id: replacement.id,
      },
      data: {
        status:
          'REQUIRES_RECONCILIATION',
        errorCode:
          err?.code ||
          'ESIM_REPLACEMENT_CLEANUP_FAILED',
        errorMessage:
          String(
            err?.message ||
            'Old eSIM cleanup failed after replacement retry'
          ),
      },
    });

    throw err;
  }

  return prismaClient.esimReplacement.findUnique({
    where: {
      id: replacement.id,
    },
    include: {
      oldSubscriber: true,
      newSubscriber: true,
      purchase: true,
    },
  });
}


export async function reconcileEsimReplacement(
  replacementId,
  {
    prismaClient = prisma,
    provider = esimProvider,
    testMode = false,
  } = {}
) {
  const normalizedId =
    String(replacementId || '').trim();

  if (!normalizedId) {
    throw makeError(
      'A valid replacementId is required',
      'ESIM_REPLACEMENT_INVALID_REPLACEMENT_ID'
    );
  }

  const replacement =
    await prismaClient.esimReplacement.findUnique({
      where: {
        id: normalizedId,
      },
      include: {
        oldSubscriber: true,
        newSubscriber: true,
        purchase: true,
      },
    });

  if (!replacement) {
    throw makeError(
      'eSIM replacement not found',
      'ESIM_REPLACEMENT_NOT_FOUND'
    );
  }

  if (replacement.status === 'COMPLETED') {
    return replacement;
  }

  if (
    replacement.status !==
    'REQUIRES_RECONCILIATION'
  ) {
    throw makeError(
      'eSIM replacement is not awaiting reconciliation',
      'ESIM_REPLACEMENT_NOT_RECONCILABLE'
    );
  }

  /*
   * Without the new provider package ID we cannot prove whether the
   * package-creation POST succeeded. Never retry provisioning here.
   */
  if (!replacement.newProviderPurchaseId) {
    throw makeError(
      'Replacement package outcome is still unknown and requires provider investigation',
      'ESIM_REPLACEMENT_PROVIDER_OUTCOME_UNKNOWN'
    );
  }

  const oldSubscriber =
    replacement.oldSubscriber;

  if (!oldSubscriber) {
    throw makeError(
      'Old eSIM Subscriber is missing',
      'ESIM_REPLACEMENT_OLD_SUBSCRIBER_MISSING'
    );
  }

  /*
   * If cleanup fails again, preserve the replacement service and put
   * the workflow back into reconciliation. Never provision here.
   */
  try {
    /*
     * A known provider package does NOT by itself prove that Chatforia's
     * canonical entitlement was switched successfully.
     *
     * If provisionedAt is absent, package creation succeeded externally
     * but the canonical transaction did not commit (or cannot be proven
     * to have committed). Restore that transaction before any destructive
     * cleanup of the old service.
     *
     * Never call provisionEsimPack here: newProviderPurchaseId proves the
     * replacement package already exists.
     */
    if (!replacement.provisionedAt) {
      if (
        !replacement.newSubscriber ||
        !replacement.newSubscriberId ||
        !replacement.newIccid ||
        !replacement.purchase ||
        !replacement.purchaseId ||
        !replacement.userId
      ) {
        throw makeError(
          'Known replacement package is missing canonical recovery data',
          'ESIM_REPLACEMENT_CANONICAL_DATA_MISSING'
        );
      }

      const recoveryExpiresAt =
        replacement.originalExpiresAt ||
        replacement.purchase.expiresAt;

      if (!recoveryExpiresAt) {
        throw makeError(
          'Known replacement package is missing its replacement expiration',
          'ESIM_REPLACEMENT_CANONICAL_DATA_MISSING'
        );
      }

      const recoveryRemainingMb =
        Number(
          replacement.remainingDataMb
        );

      if (
        !Number.isFinite(
          recoveryRemainingMb
        ) ||
        recoveryRemainingMb < 0
      ) {
        throw makeError(
          'Known replacement package is missing its replacement balance',
          'ESIM_REPLACEMENT_CANONICAL_DATA_MISSING'
        );
      }

      /*
       * Reconstruct only provider fields that were durably checkpointed.
       * Telna installation credentials remain on Subscriber.
       */
      const recoveryProviderPack = {
        providerPurchaseId:
          String(
            replacement.newProviderPurchaseId
          ),
        iccid:
          replacement.newIccid,
        expiresAt:
          recoveryExpiresAt,
        qrCodeSvg:
          null,
      };

      await persistProvisionedReplacement({
        prismaClient,
        replacement,
        newSubscriber:
          replacement.newSubscriber,
        oldSubscriber,
        purchaseId:
          replacement.purchaseId,
        userId:
          replacement.userId,
        oldIccid:
          replacement.oldIccid,
        providerPack:
          recoveryProviderPack,
        providerProfileId:
          replacement.newProviderProfileId,
        remainingDataMb:
          recoveryRemainingMb,
        expiresAt:
          recoveryExpiresAt,
      });
    }

    await completeOldEsimCleanup({
      prismaClient,
      provider,
      replacement,
      oldSubscriber,
      oldProviderPurchaseId:
        replacement.oldProviderPurchaseId,
      oldProviderProfileId:
        replacement.oldProviderProfileId,
      oldIccid:
        replacement.oldIccid,
      testMode,
    });
  } catch (err) {
    /*
     * Best effort: preserve the fact that recovery is still required.
     * If this audit update itself fails, retain the original cleanup
     * error as the exception seen by the caller.
     */
    try {
      await prismaClient.esimReplacement.update({
        where: {
          id: replacement.id,
        },
        data: {
          status:
            'REQUIRES_RECONCILIATION',
          errorCode:
            err?.code ||
            'ESIM_REPLACEMENT_RECONCILIATION_FAILED',
          errorMessage:
            String(
              err?.message ||
              'eSIM replacement reconciliation failed'
            ),
        },
      });
    } catch {
      // Do not mask the original cleanup failure.
    }

    throw err;
  }

  return prismaClient.esimReplacement.findUnique({
    where: {
      id: replacement.id,
    },
    include: {
      oldSubscriber: true,
      newSubscriber: true,
      purchase: true,
    },
  });
}

export default {
  chooseReplacementPack,
  replaceEsimForDevice,
  retryFailedEsimReplacement,
  reconcileEsimReplacement,
};
