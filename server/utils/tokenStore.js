import crypto from 'crypto';
import prisma from '../utils/prismaClient.js';

const TTL_MINUTES = Number(process.env.PASSWORD_RESET_TOKEN_TTL_MINUTES || 30);

/** sha256 hex */
export function hashToken(token) {
  return crypto.createHash('sha256').update(token, 'utf8').digest('hex');
}

/**
 * Create a new reset token for userId:
 * - returns { token, expiresAt } where `token` is plaintext to email
 * - stores only the hash in DB
 */
export async function createResetToken(userId, ttlMinutes = TTL_MINUTES) {
  const token = crypto.randomBytes(32).toString('hex');
  const tokenHash = hashToken(token);
  const expiresAt = new Date(Date.now() + ttlMinutes * 60 * 1000);

  // one active token per user -> delete previous unused tokens (defense-in-depth)
  await prisma.passwordResetToken.deleteMany({
    where: { userId, usedAt: null },
  });

  await prisma.passwordResetToken.create({
    data: { userId, tokenHash, expiresAt },
  });

  return { token, expiresAt };
}

/**
 * Consume a token (one-time use):
 * - verifies not expired and not used
 * - marks usedAt
 * - returns the userId
 */
export async function consumeResetToken(plaintextToken) {
  const tokenHash = hashToken(plaintextToken);

  const rec = await prisma.passwordResetToken.findFirst({
    where: { tokenHash },
    select: { id: true, userId: true, expiresAt: true, usedAt: true },
  });

  if (!rec) return { ok: false, reason: 'invalid' };
  if (rec.usedAt) return { ok: false, reason: 'used' };
  if (rec.expiresAt && rec.expiresAt.getTime() < Date.now()) {
    return { ok: false, reason: 'expired' };
  }

  await prisma.passwordResetToken.update({
    where: { id: rec.id },
    data: { usedAt: new Date() },
  });

  return { ok: true, userId: rec.userId };
}

/**
 * Delete expired tokens and also delete tokens that WERE used
 * but are older than N days (default 7).
 *
 * Returns { expired, oldUsed } with row counts for each bucket.
 */
export async function purgeTokens(days = 7) {
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  const [expired, oldUsed] = await Promise.all([
    prisma.passwordResetToken.deleteMany({
      where: {
        expiresAt: { lt: new Date() },
      },
    }),
    prisma.passwordResetToken.deleteMany({
      where: {
        usedAt: {
          not: null,
          lt: cutoff,
        },
      },
    }),
  ]);

  return { expired: expired.count, oldUsed: oldUsed.count };
}
