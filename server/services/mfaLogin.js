import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import speakeasy from 'speakeasy';
import prisma from '../utils/prismaClient.js';
import { open } from '../utils/secretBox.js';

const secret = process.env.JWT_SECRET || (process.env.NODE_ENV === 'test' ? 'test_secret' : 'dev_secret');
if (process.env.NODE_ENV === 'production' && !process.env.JWT_SECRET) throw new Error('JWT_SECRET is required in production');
const digest = (value) => crypto.createHash('sha256').update(value).digest('hex');
export const normalizeRecoveryCode = (value) => String(value).toUpperCase().replace(/[^A-Z0-9]/g, '');
export const recoveryCodeHash = (value) => digest(normalizeRecoveryCode(value));

export async function lockMfaUser(tx, userId) {
  await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${userId} FOR UPDATE`;
  const user = await tx.user.findUnique({ where: { id: userId } });
  return user && !user.isBanned && !user.deletedAt ? user : null;
}

// Challenge records also track failed attempts. No migration or Redis dependency.
export async function createMfaChallenge(account, nextUrl = null) {
  const jti = crypto.randomBytes(32).toString('hex');
  return prisma.$transaction(async (tx) => {
    const user = await lockMfaUser(tx, Number(account.id));
    if (!user?.twoFactorEnabled || !user.totpSecretEnc) throw new Error('MFA account unavailable');
    const token = jwt.sign({ sub: String(user.id), typ: 'mfa', jti,
      tokenVersion: user.tokenVersion ?? 0, secretHash: digest(user.totpSecretEnc), nextUrl },
    secret, { algorithm: 'HS256', expiresIn: '5m' });
    await tx.verificationToken.create({ data: {
      userId: user.id, type: 'mfa_login:0', tokenHash: digest(jti),
      expiresAt: new Date(Date.now() + 5 * 60 * 1000),
    } });
    return token;
  });
}

export async function completeMfaChallenge(token, suppliedCode) {
  const invalid = { ok: false, status: 401, error: 'Invalid or expired MFA challenge' };
  let claims;
  try {
    if (typeof token !== 'string' || token.length > 4096) return invalid;
    claims = jwt.verify(token, secret, { algorithms: ['HS256'], maxAge: '5m' });
    if (claims.typ !== 'mfa' || !/^[a-f0-9]{64}$/.test(claims.jti || '') ||
        !Number.isSafeInteger(Number(claims.sub)) || Number(claims.sub) <= 0 || !claims.exp) return invalid;
  } catch { return invalid; }
  if (typeof suppliedCode !== 'string' || suppliedCode.length > 64 || !suppliedCode.trim()) {
    return { ok: false, status: 400, error: 'Enter a verification code' };
  }
  return prisma.$transaction(async (tx) => {
    const user = await lockMfaUser(tx, Number(claims.sub));
    if (!user?.twoFactorEnabled || !user.totpSecretEnc ||
        (user.tokenVersion ?? 0) !== claims.tokenVersion || digest(user.totpSecretEnc) !== claims.secretHash) return invalid;
    const record = await tx.verificationToken.findFirst({ where: {
      userId: user.id, tokenHash: digest(claims.jti), type: { startsWith: 'mfa_login:' },
      usedAt: null, expiresAt: { gt: new Date() },
    } });
    if (!record) return invalid;
    const attempts = Number(record.type.split(':')[1]);
    if (!Number.isInteger(attempts) || attempts >= 5) return invalid;
    const code = suppliedCode.trim();
    let accepted = /^\d{6}$/.test(code) && speakeasy.totp.verify({
      secret: open(user.totpSecretEnc), encoding: 'base32', token: code, window: 1,
    });
    if (!accepted) {
      // Match canonical new hashes and exact legacy printed-code hashes.
      const hashes = [...new Set([recoveryCodeHash(code), digest(code.toUpperCase())])];
      const recovery = await tx.twoFactorRecoveryCode.findFirst({
        where: { userId: user.id, codeHash: { in: hashes }, usedAt: null },
      });
      if (recovery) {
        const claimed = await tx.twoFactorRecoveryCode.updateMany({
          where: { id: recovery.id, userId: user.id, usedAt: null }, data: { usedAt: new Date() },
        });
        accepted = claimed.count === 1;
      }
    }
    if (!accepted) {
      await tx.verificationToken.update({ where: { id: record.id }, data: {
        type: `mfa_login:${attempts + 1}`, ...(attempts + 1 >= 5 ? { usedAt: new Date() } : {}),
      } });
      return { ok: false, status: attempts + 1 >= 5 ? 429 : 400,
        error: attempts + 1 >= 5 ? 'Too many attempts. Start sign-in again.' : 'Invalid verification code' };
    }
    const consumed = await tx.verificationToken.updateMany({
      where: { id: record.id, usedAt: null, expiresAt: { gt: new Date() } }, data: { usedAt: new Date() },
    });
    if (consumed.count !== 1) throw new Error('MFA challenge changed during completion');
    return { ok: true, user, nextUrl: claims.nextUrl ?? null };
  });
}
