import database from '../utils/prismaClient.js';

import {
  createStaffAuthorizationAssertion,
} from './staffAuthorizationAssertion.js';
import {
  authorizeStaffGrantChange,
} from './staffManagementPreflight.js';
import {
  isRetryableTransactionConflict,
} from './transactionConflicts.js';



/**
 * Protected delegated staff grant/change/reactivation.
 *
 * Only the PostgreSQL SECURITY DEFINER function may mutate
 * staff assignments, session versions, and audit records.
 */
export async function grantOrChangeStaffAccess({
  actorUserId,
  targetUserId,
  targetProfile,
  authentication,
  reason,
  db = database,
}) {
  if (
    typeof reason !== 'string' ||
    reason.trim().length < 5 ||
    reason.trim().length > 500
  ) {
    throw new Error('Staff access change reason is required.');
  }

  if (typeof db?.$transaction !== 'function') {
    throw new Error('Transactional database client required.');
  }

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await db.$transaction(async (tx) => {
        // Full authorization is repeated on every retry.
        await authorizeStaffGrantChange(tx, {
          actorUserId,
          targetUserId,
          targetProfile,
          authentication,
        });

        const assertion = createStaffAuthorizationAssertion({
          actorUserId,
          targetUserId,
          action: 'STAFF_ACCESS_GRANT_OR_CHANGE',
          targetProfile,
          tokenVersion: authentication.tokenVersion,
          mfaVerified: authentication.mfaVerified,
        });

        const rows = await tx.$queryRaw`
          SELECT staff_security.grant_or_change_staff_access(
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
          throw new Error('Invalid protected staff grant response.');
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
