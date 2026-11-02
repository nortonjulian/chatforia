import {
  lockFounderIdentity,
} from './lockFounderIdentity.js';

import {
  lockStaffManagementUsers,
} from './staffTransactionLocks.js';

import {
  isEligibleStaffActor,
} from './staffAccountEligibility.js';

import {
  canRevokeStaffProfile,
} from './staffDelegation.js';

/**
 * Authorize delegated staff revocation inside a transaction.
 *
 * Revocation intentionally does not require target MFA
 * enrollment or email verification.
 *
 * All identity and assignment records must be loaded
 * after acquiring the transaction's database locks.
 */
export async function authorizeStaffRevocation(tx, {
  actorUserId,
  targetUserId,
  authentication,
}) {
  if (
    !Number.isSafeInteger(authentication?.tokenVersion) ||
    authentication.tokenVersion < 0 ||
    authentication.mfaVerified !== true
  ) {
    throw new Error('Verified staff session required.');
  }

  await lockFounderIdentity(
    tx,
    actorUserId,
    targetUserId
  );

  await lockStaffManagementUsers(
    tx,
    actorUserId,
    targetUserId
  );

  const [actor, target] = await Promise.all([
    tx.user.findUnique({
      where: { id: actorUserId },
    }),
    tx.user.findUnique({
      where: { id: targetUserId },
    }),
  ]);

  if (
    !isEligibleStaffActor(actor, authentication) ||
    !target ||
    target.id !== targetUserId ||
    target.role !== 'USER' ||
    target.isSystem !== false ||
    target.isTestAccount !== false
  ) {
    throw new Error('Staff revocation account eligibility denied.');
  }

  if (
    actor.tokenVersion !== authentication.tokenVersion
  ) {
    throw new Error('Staff session is no longer current.');
  }

  const [actorAssignment, targetAssignment] =
    await Promise.all([
      tx.staffAssignment.findUnique({
        where: { userId: actorUserId },
      }),
      tx.staffAssignment.findUnique({
        where: { userId: targetUserId },
      }),
    ]);

  if (
    !actorAssignment ||
    actorAssignment.revokedAt !== null ||
    actorAssignment.revokedById !== null
  ) {
    throw new Error('Staff revocation authority denied.');
  }

  if (!canRevokeStaffProfile({
    actorUserId,
    targetUserId,
    actorAssignment,
    existingTargetAssignment: targetAssignment,
  })) {
    throw new Error('Staff revocation authority denied.');
  }

  return {
    actor,
    target,
    actorAssignment,
    targetAssignment,
  };
}
