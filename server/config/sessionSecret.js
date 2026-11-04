// Production must never sign browser sessions with the historical literal
// fallback. Keep local/test behavior compatible with isolated QA.
export function resolveSessionSecret({ isProd, secret, jwtSecret }) {
  if (!isProd) return secret || 'change-me';
  if (
    typeof secret !== 'string' ||
    Buffer.byteLength(secret) < 32 ||
    secret.trim() !== secret ||
    secret === 'change-me' ||
    secret === jwtSecret
  ) {
    throw new Error(
      'SESSION_SECRET must be an independent secret of at least 32 bytes in production'
    );
  }
  return secret;
}
