import crypto from 'crypto';
import prisma from '../utils/prismaClient.js';

export const MINUTES = (n) => n;

function sha256Hex(s) {
  return crypto.createHash('sha256').update(s, 'utf8').digest('hex');
}

export async function createVerificationToken(userId, type, ttlMinutes) {
  const token = crypto.randomBytes(32).toString('hex');
  const tokenHash = sha256Hex(token);
  const expiresAt = new Date(Date.now() + ttlMinutes * 60 * 1000);
  await prisma.verificationToken.deleteMany({ where: { userId, type, usedAt: null } });
  await prisma.verificationToken.create({ data: { userId, type, tokenHash, expiresAt } });
  return { token, expiresAt };
}

export async function consumeVerificationToken(userId, type, tokenPlain) {
  const tokenHash = sha256Hex(tokenPlain);
  const rec = await prisma.verificationToken.findFirst({ where: { userId, type, tokenHash } });
  if (!rec) return { ok: false, reason: 'invalid' };
  if (rec.usedAt) return { ok: false, reason: 'used' };
  if (rec.expiresAt < new Date()) return { ok: false, reason: 'expired' };
  await prisma.verificationToken.update({ where: { id: rec.id }, data: { usedAt: new Date() } });
  return { ok: true };
}
