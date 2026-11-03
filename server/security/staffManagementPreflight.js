import {
  lockFounderIdentity,
} from './lockFounderIdentity.js';
import {
  isEligibleStaffActor,
  isEligibleStaffTarget,
} from './staffAccountEligibility.js';
import {
  canDelegateStaffProfile,
} from './staffDelegation.js';
import {
  lockStaffManagementUsers,
} from './staffTransactionLocks.js';

/**
 * Authorize a staff grant/change within an existing transaction.
 *
 * Must be invoked by a trusted server-side service using the
 * authenticated session context from requireAuth.
 *
 * This function performs no database writes.
 */
export async function authorizeStaffGrantChange(tx, {
  actorUserId,
  targetUserId,
  targetProfile,
  authentication,
}) {
  if (
    !Number.isSafeInteger(authentication?.tokenVersion) ||
    authentication.tokenVersion < 0 ||
    authentication?.mfaVerified !== true
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
    !isEligibleStaffTarget(target)
  ) {
    throw new Error('Staff account eligibility denied.');
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
    throw new Error('Staff delegation authority denied.');
  }

  if (!canDelegateStaffProfile({
    actorUserId,
    targetUserId,
    actorAssignment,
    targetProfile,
    existingTargetAssignment: targetAssignment,
  })) {
    throw new Error('Staff delegation authority denied.');
  }

  return {
    actor,
    target,
    actorAssignment,
    targetAssignment,
  };
}
