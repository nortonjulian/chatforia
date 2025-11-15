import crypto from 'node:crypto';

/**
 * Generate a new random token as hex string.
 * Default 32 bytes -> 64 hex chars.
 */
export function newRawToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString('hex');
}

/**
 * Hash a token with SHA-256 (hex).
 * Kept async so it fits nicely with "await hashToken(...)"
 * in existing code.
 */
export async function hashToken(token) {
  return crypto.createHash('sha256').update(token, 'utf8').digest('hex');
}

/**
 * Constant-time-ish verify function:
 * - re-hashes the supplied token
 * - compares hashes without early exit
 */
export async function verifyHash(token, expectedHash) {
  const actual = await hashToken(token);

  if (actual.length !== expectedHash.length) return false;

  let mismatch = 0;
  for (let i = 0; i < actual.length; i += 1) {
    mismatch |= actual.charCodeAt(i) ^ expectedHash.charCodeAt(i);
  }
  return mismatch === 0;
}
