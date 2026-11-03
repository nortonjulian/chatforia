import database from '../utils/prismaClient.js';

import {
  isKnownStaffProfile,
} from './staffPermissions.js';

/**
 * Read the current staff assignment from the database.
 *
 * Never accept a profile from a request body or JWT.
 * Missing or revoked assignments grant no permissions.
 */
export async function lookupStaffAssignment(
  userId,
  db = database
) {
  if (
    !Number.isSafeInteger(userId) ||
    userId <= 0
  ) {
    return null;
  }

  const assignment = await db.staffAssignment.findUnique({
    where: { userId },
    select: {
      profile: true,
      active: true,
      revokedAt: true,
      revokedById: true,
      user: {
        select: {
          isBanned: true,
          deletedAt: true,
        },
      },
    },
  });

  if (
    !assignment ||
    assignment.active !== true ||
    assignment.revokedAt !== null ||
    assignment.revokedById !== null ||
    assignment.user?.isBanned !== false ||
    assignment.user?.deletedAt !== null ||
    !isKnownStaffProfile(assignment.profile)
  ) {
    return null;
  }

  return {
    profile: assignment.profile,
    active: true,
  };
}
