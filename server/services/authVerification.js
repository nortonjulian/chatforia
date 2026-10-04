import crypto from 'node:crypto';
import prisma from '../utils/prismaClient.js';
import { REGISTRATION_PHONE_INTENT, phoneProofHash } from './registrationPhone.js';

const MAX_SMS_ATTEMPTS = 5;
const digest = (value) => crypto.createHash('sha256').update(value, 'utf8').digest('hex');

// Sending and checking a code for the same phone share a transaction lock.
async function lockPhone(tx, phone) {
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${phone})::bigint)::text AS locked`;
}

export async function consumeEmailVerification(userId, tokenHash) {
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${userId} FOR UPDATE`;
    const user = await tx.user.findUnique({ where: { id: userId } });
    if (!user || user.isBanned || user.deletedAt || !user.email) return false;

    const now = new Date();
    const record = await tx.verificationToken.findFirst({
      where: { userId, type: 'email', tokenHash, usedAt: null, expiresAt: { gt: now } },
      orderBy: { createdAt: 'desc' },
    });
    if (!record) return false;

    const claimed = await tx.verificationToken.updateMany({
      where: { id: record.id, userId, type: 'email', tokenHash, usedAt: null, expiresAt: { gt: new Date() } },
      data: { usedAt: new Date() },
    });
    if (claimed.count !== 1) return false;
    await tx.user.update({ where: { id: userId }, data: { emailVerifiedAt: new Date() } });
    return true;
  });
}

export async function createPhoneVerification({ phone, ipAddress, userAgent, consentTextVersion }) {
  return prisma.$transaction(async (tx) => {
    await lockPhone(tx, phone);
    const now = new Date();
    const recentCount = await tx.phoneOtp.count({
      where: { phone, createdAt: { gt: new Date(now.getTime() - 60 * 60 * 1000) } },
    });
    if (recentCount >= 5) return { status: 429, message: 'Too many code requests for this phone' };

    // Retain old rows for the hourly limit, but only the newest code is usable.
    await tx.phoneOtp.updateMany({ where: { phone, expiresAt: { gt: now } }, data: { expiresAt: now } });
    await tx.smsConsent.create({
      data: { phone, consentTextVersion, ipAddress, userAgent },
    });
    const code = String(crypto.randomInt(100000, 1000000));
    const record = await tx.phoneOtp.create({
      data: { phone, otpCode: `sha256:${digest(code)}`, expiresAt: new Date(now.getTime() + 10 * 60 * 1000) },
    });
    return { status: 200, id: record.id, code };
  });
}

export async function consumePhoneVerification(phone, code) {
  return prisma.$transaction(async (tx) => {
    await lockPhone(tx, phone);
    const record = await tx.phoneOtp.findFirst({
      where: { phone }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });
    if (!record) return { status: 400, message: 'No verification code found' };
    if (record.attempts >= MAX_SMS_ATTEMPTS) return { status: 429, message: 'Too many attempts; request a new code' };
    if (record.expiresAt <= new Date()) return { status: 400, message: 'Code expired' };

    // Accept existing plaintext rows until they expire; new rows store hashes.
    const expected = record.otpCode.startsWith('sha256:') ? record.otpCode.slice(7) : digest(record.otpCode);
    const actual = digest(code);
    const matches = /^[a-f0-9]{64}$/.test(expected) && crypto.timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(actual, 'hex'));
    if (!matches) {
      const attempts = record.attempts + 1;
      await tx.phoneOtp.update({ where: { id: record.id }, data: { attempts } });
      return { status: attempts >= MAX_SMS_ATTEMPTS ? 429 : 400, message: attempts >= MAX_SMS_ATTEMPTS ? 'Too many attempts; request a new code' : 'Invalid code' };
    }

    const claimed = await tx.phoneOtp.updateMany({
      where: { id: record.id, phone, otpCode: record.otpCode, attempts: { lt: MAX_SMS_ATTEMPTS }, expiresAt: { gt: new Date() } },
      data: { expiresAt: new Date() },
    });
    if (claimed.count !== 1) return { status: 400, message: 'Code expired' };
    const consent = await tx.smsConsent.findFirst({ where: { phone }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] });
    if (!consent) throw new Error('SMS consent record missing');
    const phoneVerificationId = crypto.randomBytes(32).toString('hex');
    await tx.phoneVerificationRequest.create({
      data: {
        phoneNumber: phone,
        verificationCode: 'spent',
        consentedAt: consent.createdAt,
        intent: REGISTRATION_PHONE_INTENT,
        verifiedAt: new Date(),
        expiresAt: new Date(Date.now() + 10 * 60 * 1000),
        phoneVerificationId: phoneProofHash(phoneVerificationId),
      },
    });
    return { status: 200, message: 'Phone verified', phoneVerificationId, pendingRegistration: null };
  });
}
