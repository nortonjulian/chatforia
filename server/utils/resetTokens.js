import crypto from 'crypto';
import prisma from './prismaClient.js';

// how long tokens last, in minutes
const TTL_MINUTES = Number(process.env.PASSWORD_RESET_TOKEN_TTL_MINUTES || 30);

// deterministic sha256 hex
export function hashToken(token) {
  return crypto.createHash('sha256').update(token, 'utf8').digest('hex');
}

/**
 * issueResetToken(userId)
 * - generate random token
 * - hash it
 * - delete any older unused tokens for this user
 * - insert new row with expiresAt (now + TTL_MINUTES)
 * - return plaintext token so caller can email it
 */
export async function issueResetToken(userId) {
  const raw = crypto.randomBytes(32).toString('hex');
  const tokenHash = hashToken(raw);

  const expiresAt = new Date(
    Date.now() + TTL_MINUTES * 60 * 1000
  );

  await prisma.$transaction(async (tx) => {
    // Serialize issuance and consumption for this account.
    const active = await lockActiveUser(tx, userId);
    if (!active) throw new Error('Password reset account unavailable');
    await tx.passwordResetToken.deleteMany({ where: { userId, usedAt: null } });
    await tx.passwordResetToken.create({
      data: { userId, tokenHash, expiresAt, usedAt: null },
    });
  });

  // caller will email/sms this plaintext
  return raw;
}

// Account lock prevents concurrent issuance/reset from leaving extra valid links.
async function lockActiveUser(tx, userId) {
  const rows = await tx.$queryRaw`
    SELECT id FROM "User"
    WHERE id = ${userId} AND "deletedAt" IS NULL AND "isBanned" = false
    FOR UPDATE
  `;
  return rows.length === 1;
}

/**
 * Claim a reset token exactly once. Pass the route's transaction so the claim,
 * password change, and session revocation either all commit or all roll back.
 */
export async function consumeResetToken(plaintext, tx = null) {
  if (typeof plaintext !== 'string' || !/^[a-f0-9]{64}$/.test(plaintext)) return null;
  if (!tx) return prisma.$transaction((client) => consumeResetToken(plaintext, client));
  const tokenHash = hashToken(plaintext);
  const rec = await tx.passwordResetToken.findFirst({
    where: { tokenHash, usedAt: null, expiresAt: { gt: new Date() } },
    select: { id: true, userId: true },
  });
  if (!rec || !await lockActiveUser(tx, rec.userId)) return null;

  // Recheck after waiting for the account lock; another request may have won.
  const now = new Date();
  const claimed = await tx.passwordResetToken.updateMany({
    where: { id: rec.id, tokenHash, usedAt: null, expiresAt: { gt: now } },
    data: { usedAt: now },
  });
  return claimed.count === 1 ? rec.userId : null;
}

/**
 * purgeResetTokens({ expiredOnly = true, userId } = {})
 * - if expiredOnly === true:
 *     delete tokens where expiresAt < now
 *     (optionally scoped to userId)
 * - if expiredOnly === false:
 *     delete ALL tokens for that user (must have userId)
 *
 * returns { count }
 */
export async function purgeResetTokens(opts = {}) {
  const { expiredOnly = true, userId } = opts;
  const where = {};
  if (!expiredOnly && userId === undefined) {
    throw new Error('userId is required when purging all reset tokens');
  }

  if (expiredOnly) {
    where.expiresAt = { lt: new Date(Date.now()) };
  }

  if (userId !== undefined) {
    where.userId = Number(userId);
  }

  // special case: expiredOnly === false means "delete all tokens for this user"
  // (this skips expiresAt filter entirely, but requires userId)
  if (expiredOnly === false && userId !== undefined) {
    delete where.expiresAt;
  }

  return prisma.passwordResetToken.deleteMany({ where });
}
