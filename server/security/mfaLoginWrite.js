import crypto from 'node:crypto';

// Domain separation prevents login assertions being used for staff delegation.
export async function mfaLoginWrite(tx, user, operation, data) {
  const secret = process.env.STAFF_ACCESS_SIGNING_SECRET;
  if (typeof secret !== 'string' || Buffer.byteLength(secret) < 32) {
    throw new Error('Staff authentication signing configuration unavailable');
  }
  const payload = JSON.stringify({
    ...data,
    userId: user.id,
    tokenVersion: user.tokenVersion,
    operation,
    nonce: crypto.randomUUID(),
    exp: Math.floor(Date.now() / 1000) + 30,
  });
  const signature = crypto
    .createHmac('sha256', secret)
    .update(`mfa-login:${payload}`)
    .digest('hex');
  const rows = await tx.$queryRaw`
    SELECT staff_security.mfa_login_write(${payload}::text, ${signature}::text) AS result
  `;
  if (rows?.[0]?.result !== 1) throw new Error('MFA write failed');
}
