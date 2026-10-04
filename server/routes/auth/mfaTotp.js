import express from 'express';
import prisma from '../../utils/prismaClient.js';
import speakeasy from 'speakeasy';
import qrcode from 'qrcode';
import crypto from 'node:crypto';
import { seal, open } from '../../utils/secretBox.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { issueSession } from '../auth.js';
import { lockMfaUser, recoveryCodeHash } from '../../services/mfaLogin.js';

export const router = express.Router();
const validCode = (code) => typeof code === 'string' && /^\d{6}$/.test(code);
function makeBackup() {
  return Array.from({ length: 10 }, () => {
    const raw = crypto.randomBytes(8).toString('hex').toUpperCase();
    return raw.match(/.{4}/g).join('-');
  });
}

// Mounted at /auth/2fa. The pending secret belongs to the authenticated account.
router.post('/setup', asyncHandler(async (req, res) => {
  const generated = speakeasy.generateSecret({ length: 20,
    name: `Chatforia (${req.user.username})`, issuer: 'Chatforia' });
  const qrDataUrl = await qrcode.toDataURL(generated.otpauth_url);
  const prepared = await prisma.$transaction(async (tx) => {
    const user = await lockMfaUser(tx, req.user.id);
    if (!user || user.twoFactorEnabled || (user.tokenVersion ?? 0) !== (req.user.tokenVersion ?? 0)) return false;
    await tx.verificationToken.updateMany({
      where: { userId: user.id, type: 'mfa_setup', usedAt: null }, data: { usedAt: new Date() },
    });
    await tx.verificationToken.create({ data: {
      userId: user.id, type: 'mfa_setup', tokenHash: seal(generated.base32),
      expiresAt: new Date(Date.now() + 10 * 60 * 1000),
    } });
    return true;
  });
  if (!prepared) return res.status(409).json({ ok: false, error: 'MFA already enabled or account unavailable' });
  res.set('Cache-Control', 'no-store');
  return res.json({ ok: true, tmpSecret: generated.base32, qrDataUrl });
}));

router.post('/enable', asyncHandler(async (req, res) => {
  const { tmpSecret, code } = req.body || {};
  if (typeof tmpSecret !== 'string' || tmpSecret.length > 128 || !validCode(code)) {
    return res.status(400).json({ ok: false, reason: 'bad_code' });
  }
  const backupCodes = makeBackup();
  const enabled = await prisma.$transaction(async (tx) => {
    const user = await lockMfaUser(tx, req.user.id);
    if (!user || user.twoFactorEnabled || (user.tokenVersion ?? 0) !== (req.user.tokenVersion ?? 0)) return false;
    const pending = await tx.verificationToken.findFirst({ where: {
      userId: user.id, type: 'mfa_setup', usedAt: null, expiresAt: { gt: new Date() },
    }, orderBy: { createdAt: 'desc' } });
    if (!pending) return false;
    const secret = open(pending.tokenHash);
    if (secret !== tmpSecret || !speakeasy.totp.verify({ secret, encoding: 'base32', token: code, window: 1 })) return false;
    const updated = await tx.user.update({ where: { id: user.id }, data: {
      twoFactorEnabled: true, totpSecretEnc: seal(secret), twoFactorEnrolledAt: new Date(),
      tokenVersion: { increment: 1 },
    } });
    await tx.verificationToken.update({ where: { id: pending.id }, data: { usedAt: new Date() } });
    await tx.twoFactorRecoveryCode.deleteMany({ where: { userId: user.id } });
    await tx.twoFactorRecoveryCode.createMany({ data: backupCodes.map((value) => ({
      userId: user.id, codeHash: recoveryCodeHash(value),
    })) });
    return updated;
  });
  if (!enabled) return res.status(400).json({ ok: false, reason: 'bad_code' });
  res.set('Cache-Control', 'no-store');
  const token = issueSession(res, enabled, { mfaVerified: true });
  return res.json({ ok: true, backupCodes, token });
}));

router.post('/disable', asyncHandler(async (req, res) => {
  const { code } = req.body || {};
  if (!validCode(code)) return res.status(400).json({ ok: false, reason: 'bad_code' });
  const disabled = await prisma.$transaction(async (tx) => {
    const user = await lockMfaUser(tx, req.user.id);
    if (!user?.twoFactorEnabled || !user.totpSecretEnc || (user.tokenVersion ?? 0) !== (req.user.tokenVersion ?? 0)) return false;
    if (!speakeasy.totp.verify({ secret: open(user.totpSecretEnc), encoding: 'base32', token: code, window: 1 })) return false;
    const updated = await tx.user.update({ where: { id: user.id }, data: {
      twoFactorEnabled: false, totpSecretEnc: null, twoFactorEnrolledAt: null,
      tokenVersion: { increment: 1 },
    } });
    await tx.twoFactorRecoveryCode.deleteMany({ where: { userId: user.id } });
    await tx.verificationToken.updateMany({ where: {
      userId: user.id, type: { startsWith: 'mfa_' }, usedAt: null,
    }, data: { usedAt: new Date() } });
    return updated;
  });
  if (!disabled) return res.status(400).json({ ok: false, reason: 'bad_code' });
  const token = issueSession(res, disabled);
  return res.json({ ok: true, token });
}));
