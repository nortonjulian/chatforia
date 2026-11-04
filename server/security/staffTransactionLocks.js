/**
 * Lock staff-management participants in deterministic order.
 *
 * Must be called with a Prisma interactive transaction client.
 * No authorization decisions are made by this helper.
 */
export async function lockStaffManagementUsers(
  tx,
  actorUserId,
  targetUserId
) {
  if (
    !Number.isSafeInteger(actorUserId) ||
    actorUserId <= 0 ||
    !Number.isSafeInteger(targetUserId) ||
    targetUserId <= 0 ||
    actorUserId === targetUserId
  ) {
    throw new Error('Invalid staff-management account IDs.');
  }

  if (typeof tx?.$queryRaw !== 'function') {
    throw new Error('Transactional database client required.');
  }

  const ids = [actorUserId, targetUserId].sort(
    (a, b) => a - b
  );

  for (const id of ids) {
    const rows = await tx.$queryRaw`
      SELECT id
      FROM "User"
      WHERE id = ${id}
      FOR UPDATE
    `;

    if (
      !Array.isArray(rows) ||
      rows.length !== 1 ||
      Number(rows[0]?.id) !== id
    ) {
      throw new Error(
        'Staff-management account unavailable.'
      );
    }
  }

  return ids;
}
