import crypto from 'node:crypto';

// Called only after verifying the enrolled TOTP while holding the user lock.
export async function disableMfa(tx, user) {
  const secret = process.env.STAFF_ACCESS_SIGNING_SECRET;
  if (typeof secret !== 'string' || Buffer.byteLength(secret) < 32) {
    throw new Error('Staff authentication signing configuration unavailable');
  }
  const payload = JSON.stringify({
    userId: user.id,
    tokenVersion: user.tokenVersion,
    secretHash: crypto.createHash('sha256').update(user.totpSecretEnc).digest('hex'),
    nonce: crypto.randomUUID(),
    exp: Math.floor(Date.now() / 1000) + 30,
  });
  const signature = crypto.createHmac('sha256', secret)
    .update(`mfa-disable:${payload}`).digest('hex');
  const rows = await tx.$queryRaw`
    SELECT staff_security.disable_mfa(${payload}::text, ${signature}::text) AS result
  `;
  const result = rows?.[0]?.result;
  if (result !== 'disabled' && result !== 'mfa_required') throw new Error('MFA disable failed');
  return result;
}
