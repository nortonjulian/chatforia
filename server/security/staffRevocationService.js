import database from '../utils/prismaClient.js';

import {
  createStaffAuthorizationAssertion,
} from './staffAuthorizationAssertion.js';
import {
  authorizeStaffRevocation,
} from './staffRevocationPreflight.js';
import {
  isRetryableTransactionConflict,
} from './transactionConflicts.js';



/**
 * Protected delegated staff revocation.
 *
 * The ordinary User account is never deleted.
 * PostgreSQL atomically revokes staff access, invalidates
 * sessions, consumes the assertion, and writes audit history.
 */
export async function revokeStaffAccess({
  actorUserId,
  targetUserId,
  authentication,
  reason,
  db = database,
}) {
  if (
    typeof reason !== 'string' ||
    reason.trim().length < 5 ||
    reason.trim().length > 500
  ) {
    throw new Error('Staff revocation reason is required.');
  }

  if (typeof db?.$transaction !== 'function') {
    throw new Error('Transactional database client required.');
  }

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await db.$transaction(async (tx) => {
        const { targetAssignment } =
          await authorizeStaffRevocation(tx, {
            actorUserId,
            targetUserId,
            authentication,
          });

        // Bind revocation to the current locked assignment.
        const assertion = createStaffAuthorizationAssertion({
          actorUserId,
          targetUserId,
          action: 'STAFF_ACCESS_REVOKE',
          targetProfile: targetAssignment.profile,
          tokenVersion: authentication.tokenVersion,
          mfaVerified: authentication.mfaVerified,
        });

        const rows = await tx.$queryRaw`
          SELECT staff_security.revoke_staff_access(
            ${assertion}::text,
            ${reason.trim()}::text
          ) AS result
        `;

        if (
          !Array.isArray(rows) ||
          rows.length !== 1 ||
          !rows[0]?.result ||
          typeof rows[0].result !== 'object'
        ) {
          throw new Error('Invalid protected staff revocation response.');
        }

        return rows[0].result;
      }, {
        isolationLevel: 'Serializable',
      });
    } catch (error) {
      if (
        !isRetryableTransactionConflict(error) ||
        attempt === 2
      ) {
        throw error;
      }
    }
  }
}
