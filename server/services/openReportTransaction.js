// PostgreSQL transaction advisory locks serialize duplicate submissions across
// both app-message report routes and across API processes. The lock is released
// automatically on commit or rollback; no schema change is required.
export async function createOpenReport(prisma, { reporterId, messageId = null, reportedUserId = null }, create) {
  const lockTarget = messageId ?? -reportedUserId;
  if (!Number.isInteger(reporterId) || !Number.isInteger(lockTarget)) {
    throw new TypeError('Report lock requires integer database IDs');
  }

  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(${reporterId}::integer, ${lockTarget}::integer)::text AS locked`;
    const existing = await tx.report.findFirst({
      where: messageId == null
        ? { reporterId, reportedUserId, messageId: null, status: 'OPEN' }
        : { reporterId, messageId, status: 'OPEN' },
      select: { id: true },
    });
    if (existing) return { duplicate: true };
    return { duplicate: false, report: await create(tx) };
  });
}
