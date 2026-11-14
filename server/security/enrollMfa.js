import crypto from 'node:crypto';

// Enable is signed only after checking the account-bound pending secret and TOTP.
export async function enrollMfa(tx, user, operation, data) {
  const secret = process.env.STAFF_ACCESS_SIGNING_SECRET;
  if (typeof secret !== 'string' || Buffer.byteLength(secret) < 32) {
    throw new Error('Staff authentication signing configuration unavailable');
  }
  const payload = JSON.stringify({ ...data, operation, userId: user.id,
    tokenVersion: user.tokenVersion, nonce: crypto.randomUUID(),
    exp: Math.floor(Date.now() / 1000) + 30 });
  const signature = crypto.createHmac('sha256', secret)
    .update(`mfa-enroll:${payload}`).digest('hex');
  const rows = await tx.$queryRaw`
    SELECT staff_security.enroll_mfa(${payload}::text, ${signature}::text) AS result
  `;
  const result = rows?.[0]?.result;
  if (!['prepared', 'enabled', 'mfa_protected'].includes(result)) throw new Error('MFA enrollment failed');
  return result;
}
