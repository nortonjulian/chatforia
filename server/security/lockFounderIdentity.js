import {
  getProtectedFounderUserId,
} from './founderIdentity.js';

/**
 * Lock and verify founder ownership inside a Prisma transaction.
 *
 * Must run before staff-management user locks.
 * Ordinary delegated staff operations cannot modify or
 * impersonate the protected founder account.
 */
export async function lockFounderIdentity(
  tx,
  actorUserId,
  targetUserId
) {
  if (
    typeof tx?.$queryRaw !== 'function' ||
    typeof tx?.founderOwnership?.findUnique !== 'function'
  ) {
    throw new Error('Transactional founder verification required.');
  }

  if (
    !Number.isSafeInteger(actorUserId) ||
    actorUserId <= 0 ||
    !Number.isSafeInteger(targetUserId) ||
    targetUserId <= 0
  ) {
    throw new Error('Invalid staff-management account IDs.');
  }

  // Reserved advisory-lock namespace for founder ownership.
  // Infrastructure ownership procedures must acquire this
  // same transaction-level lock before changing the record.
  await tx.$queryRaw`
    WITH acquired AS MATERIALIZED (
      SELECT pg_advisory_xact_lock(
        ${73421}::integer,
        ${1}::integer
      )
    )
    SELECT 'locked'::text AS status
    FROM acquired
  `;

  const founderUserId = await getProtectedFounderUserId(tx);

  if (
    actorUserId === founderUserId ||
    targetUserId === founderUserId
  ) {
    throw new Error(
      'Founder account cannot participate in delegated staff management.'
    );
  }

  return founderUserId;
}
