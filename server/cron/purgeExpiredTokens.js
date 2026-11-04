import crypto from 'node:crypto';

import prisma from '../utils/prismaClient.js';
import {
  deleteExpiredOrdinaryResetTokens,
  deleteOldUsedOrdinaryResetTokens,
} from './ordinaryResetTokenCleanup.js';

const TTL_MINUTES = Number(process.env.PASSWORD_RESET_TOKEN_TTL_MINUTES || 30);

/** sha256 hex */
function hashToken(token) {
  return crypto.createHash('sha256').update(token, 'utf8').digest('hex');
}

/**
 * Create a plaintext token and store ONLY its hash in DB.
 * - Revokes any prior unused tokens for this user (single active token policy).
 * @returns {Promise<string>} plaintext token (email this!)
 */
export async function issueResetToken(userId) {
  const token = crypto.randomBytes(32).toString('hex');
  const tokenHash = hashToken(token);
  const expiresAt = new Date(Date.now() + TTL_MINUTES * 60 * 1000);

  // Optional hardening: one active token per user
  await prisma.passwordResetToken.deleteMany({ where: { userId, usedAt: null } });

  await prisma.passwordResetToken.create({
    data: { userId, tokenHash, expiresAt },
  });

  return token;
}

/**
 * Consume (one-time) a plaintext token.
 * @returns {Promise<number|null>} userId if valid; otherwise null
 */
export async function consumeResetToken(plaintextToken) {
  const tokenHash = hashToken(plaintextToken);

  const rec = await prisma.passwordResetToken.findFirst({
    where: { tokenHash },
    select: { id: true, userId: true, expiresAt: true, usedAt: true },
  });

  if (!rec) return null;
  if (rec.usedAt) return null;
  if (rec.expiresAt && rec.expiresAt.getTime() < Date.now()) return null;

  await prisma.passwordResetToken.update({
    where: { id: rec.id },
    data: { usedAt: new Date() },
  });

  return rec.userId;
}

/** Cron helper: delete expired + old used tokens */
export async function purgeResetTokens(days = 7) {
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  await deleteExpiredOrdinaryResetTokens(prisma, new Date());
  await deleteOldUsedOrdinaryResetTokens(prisma, cutoff);
}
