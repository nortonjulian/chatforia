import express from 'express';
import prisma from '../../utils/prismaClient.js';
import speakeasy from 'speakeasy';
import qrcode from 'qrcode';
import crypto from 'crypto';
import { seal, open } from '../../utils/secretBox.js';

export const router = express.Router();

function makeBackup(n=10) {
  const out = [];
  for (let i=0;i<n;i++) {
    const raw = crypto.randomBytes(8).toString('base64url').slice(0,12).toUpperCase();
    out.push(`${raw.slice(0,4)}-${raw.slice(4,8)}-${raw.slice(8,12)}`);
  }
  return out;
}

// POST /auth/2fa/setup
router.post('/2fa/setup', async (req, res) => {
  const user = req.user;
  const secret = speakeasy.generateSecret({ length: 20, name: `Chatforia (${user.username})`, issuer: 'Chatforia' });
  const qrDataUrl = await qrcode.toDataURL(secret.otpauth_url);
  res.json({ ok:true, tmpSecret: secret.base32, qrDataUrl });
});

// POST /auth/2fa/enable { tmpSecret, code }
router.post('/2fa/enable', async (req, res) => {
  const { tmpSecret, code } = req.body;
  const ok = speakeasy.totp.verify({ secret: tmpSecret, encoding: 'base32', token: code, window: 1 });
  if (!ok) return res.status(400).json({ ok:false, reason:'bad_code' });

  const backupCodes = makeBackup();
  const hashes = backupCodes.map(c => ({ userId: req.user.id, codeHash: sha256(c) }));

  await prisma.$transaction([
    prisma.user.update({
      where: { id: req.user.id },
      data: { twoFactorEnabled: true, totpSecretEnc: seal(tmpSecret), twoFactorEnrolledAt: new Date() }
    }),
    prisma.twoFactorRecoveryCode.deleteMany({ where: { userId: req.user.id } }),
    prisma.twoFactorRecoveryCode.createMany({ data: hashes })
  ]);
  res.json({ ok:true, backupCodes });
});

// POST /auth/2fa/disable { code }
router.post('/2fa/disable', async (req, res) => {
  const user = await prisma.user.findUnique({ where: { id: req.user.id } });
  const secret = user?.totpSecretEnc ? open(user.totpSecretEnc) : null;
  if (!secret) return res.status(400).json({ ok:false });

  const ok = speakeasy.totp.verify({ secret, encoding: 'base32', token: req.body.code, window: 1 });
  if (!ok) return res.status(400).json({ ok:false, reason:'bad_code' });

  await prisma.$transaction([
    prisma.user.update({ where:{ id:user.id }, data:{ twoFactorEnabled:false, totpSecretEnc:null, twoFactorEnrolledAt:null } }),
    prisma.twoFactorRecoveryCode.deleteMany({ where: { userId: user.id } })
  ]);
  res.json({ ok:true });
});

function sha256(s){ return crypto.createHash('sha256').update(s,'utf8').digest('hex'); }
