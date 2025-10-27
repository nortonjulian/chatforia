import crypto from 'crypto';
import prisma from '@utils/prismaClient.js';

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

  // wipe previous unused tokens for this user
  await prisma.passwordResetToken.deleteMany({
    where: { userId, usedAt: null },
  });

  // store only the hash
  await prisma.passwordResetToken.create({
    data: {
      userId,
      tokenHash,
      expiresAt,
      usedAt: null,
    },
  });

  // caller will email/sms this plaintext
  return raw;
}

/**
 * consumeResetToken(plaintext)
 * - return null if invalid/expired/used
 * - otherwise mark token used and return userId
 */
export async function consumeResetToken(plaintext) {
  if (!plaintext) return null;
  const tokenHash = hashToken(plaintext);

  // find unused + not expired
  const now = new Date();
  const rec = await prisma.passwordResetToken.findFirst({
    where: {
      tokenHash,
      usedAt: null,
      expiresAt: { gt: now },
    },
    select: { id: true, userId: true },
  });

  if (!rec) return null;

  // mark used
  await prisma.passwordResetToken.update({
    where: { id: rec.id },
    data: { usedAt: now },
  });

  return rec.userId;
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
