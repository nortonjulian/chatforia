import {
  STAFF_PROFILES,
  STAFF_PERMISSIONS,
  isKnownStaffProfile,
} from './staffPermissions.js';

/**
 * Delegation policy for staff profiles.
 *
 * This policy does not authenticate users or load assignments.
 * Callers must provide a verified, server-authoritative
 * actor assignment.
 *
 * Founder ownership is never represented by a staff profile.
 */

const DELEGATION_RULES = Object.freeze({
  CTO: Object.freeze([
    'ENGINEERING_MANAGER',
    'SENIOR_ENGINEER',
  ]),

  ACCESS_ADMIN: Object.freeze([
    'SENIOR_ENGINEER',
    'SUPPORT',
  ]),
});

export function canDelegateStaffProfile({
  actorUserId,
  targetUserId,
  actorAssignment,
  targetProfile,
  existingTargetAssignment = null,
}) {
  if (
    !Number.isSafeInteger(actorUserId) ||
    actorUserId <= 0 ||
    !Number.isSafeInteger(targetUserId) ||
    targetUserId <= 0 ||
    actorUserId === targetUserId
  ) {
    return false;
  }

  if (
    !actorAssignment ||
    actorAssignment.active !== true ||
    !isKnownStaffProfile(actorAssignment.profile) ||
    !isKnownStaffProfile(targetProfile)
  ) {
    return false;
  }

  const permissions =
    STAFF_PROFILES[actorAssignment.profile];

  if (
    !permissions.includes(
      STAFF_PERMISSIONS.STAFF_ASSIGN
    )
  ) {
    return false;
  }

  const allowedProfiles =
    DELEGATION_RULES[actorAssignment.profile] || [];

  if (!allowedProfiles.includes(targetProfile)) {
    return false;
  }

  if (existingTargetAssignment !== null) {
    if (
      typeof existingTargetAssignment !== 'object' ||
      !isKnownStaffProfile(existingTargetAssignment.profile) ||
      !allowedProfiles.includes(existingTargetAssignment.profile)
    ) {
      return false;
    }
  }

  return true;
}

/**
 * Revocation is permitted only within the actor's
 * explicitly delegated profile scope.
 *
 * The actor and target assignments must be loaded from
 * the database inside the privileged transaction.
 */
export function canRevokeStaffProfile({
  actorUserId,
  targetUserId,
  actorAssignment,
  existingTargetAssignment,
}) {
  if (
    !Number.isSafeInteger(actorUserId) ||
    actorUserId <= 0 ||
    !Number.isSafeInteger(targetUserId) ||
    targetUserId <= 0 ||
    actorUserId === targetUserId
  ) {
    return false;
  }

  if (
    !actorAssignment ||
    actorAssignment.active !== true ||
    !isKnownStaffProfile(actorAssignment.profile) ||
    !existingTargetAssignment ||
    existingTargetAssignment.active !== true ||
    !isKnownStaffProfile(existingTargetAssignment.profile)
  ) {
    return false;
  }

  const permissions =
    STAFF_PROFILES[actorAssignment.profile];

  if (
    !permissions.includes(
      STAFF_PERMISSIONS.STAFF_ASSIGN
    )
  ) {
    return false;
  }

  return (
    DELEGATION_RULES[
      actorAssignment.profile
    ]?.includes(existingTargetAssignment.profile) === true
  );
}
