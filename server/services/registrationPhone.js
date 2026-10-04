import crypto from 'node:crypto';

export const REGISTRATION_PHONE_INTENT = 'registration-proof-v1';
export const phoneProofHash = value => crypto.createHash('sha256').update(value, 'utf8').digest('hex');

function phoneError(code, status = 400) {
  const error = new Error(code);
  error.code = code;
  error.status = status;
  return error;
}

// Must run inside the same transaction that creates the account.
export async function attachVerifiedRegistrationPhone(tx, { userId, phone, phoneVerificationId }) {
  if (!/^\+[1-9]\d{6,14}$/.test(phone || '') || !/^[a-f0-9]{64}$/.test(phoneVerificationId || '')) {
    throw phoneError('invalid_phone_verification');
  }
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${phone})::bigint)::text AS locked`;
  const tokenHash = phoneProofHash(phoneVerificationId);
  const proof = await tx.phoneVerificationRequest.findUnique({ where: { phoneVerificationId: tokenHash } });
  if (!proof || proof.phoneNumber !== phone || proof.intent !== REGISTRATION_PHONE_INTENT ||
      !proof.verifiedAt || proof.consumedAt || proof.expiresAt <= new Date()) {
    throw phoneError('invalid_phone_verification');
  }
  const owner = await tx.user.findFirst({ where: { phoneNumber: phone, id: { not: userId } }, select: { id: true } });
  if (owner) throw phoneError('phone_already_in_use', 409);
  let phoneRow = await tx.phone.findUnique({ where: { number: phone } });
  if (phoneRow?.optedOut) throw phoneError('phone_opted_out');
  if (phoneRow?.userId != null) throw phoneError('phone_already_in_use', 409);

  const claimed = await tx.phoneVerificationRequest.updateMany({
    where: { id: proof.id, phoneVerificationId: tokenHash, intent: REGISTRATION_PHONE_INTENT,
      phoneNumber: phone, verifiedAt: { not: null }, consumedAt: null, expiresAt: { gt: new Date() } },
    data: { consumedAt: new Date() },
  });
  if (claimed.count !== 1) throw phoneError('invalid_phone_verification');
  const now = new Date();
  if (!phoneRow) {
    phoneRow = await tx.phone.create({ data: { number: phone, userId, verifiedAt: now } });
  } else {
    const attached = await tx.phone.updateMany({
      where: { id: phoneRow.id, userId: null, optedOut: false }, data: { userId, verifiedAt: now },
    });
    if (attached.count !== 1) throw phoneError('phone_already_in_use', 409);
  }
  await tx.phoneVerificationRequest.update({ where: { id: proof.id }, data: { phoneId: phoneRow.id } });
  await tx.user.update({ where: { id: userId }, data: { phoneNumber: phone, phoneVerifiedAt: now } });
}
