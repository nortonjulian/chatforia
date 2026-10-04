import axios from 'axios';
import jwt from 'jsonwebtoken';
import { createPublicKey, createHash, timingSafeEqual } from 'node:crypto';

const ISSUER = 'https://appleid.apple.com';
const CACHE_MS = 60 * 60 * 1000;
const REFRESH_COOLDOWN_MS = 30 * 1000;

function invalidToken() {
  const error = new Error('Invalid Apple token');
  error.code = 'invalid_apple_token';
  return error;
}

function sameString(left, right) {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

// Injectable key loader keeps regression tests offline. Production always
// loads keys from Apple's fixed HTTPS endpoint, never a URL from the JWT.
export function createAppleTokenVerifier({ fetchKeys, now = Date.now }) {
  let keys = [];
  let fetchedAt = null;
  let pending = null;

  async function refresh() {
    if (!pending) {
      pending = (async () => {
        const result = await fetchKeys();
        if (!Array.isArray(result) || !result.length) {
          throw new Error('Apple signing keys unavailable');
        }
        keys = result;
        fetchedAt = now();
      })();
    }
    try {
      await pending;
    } finally {
      pending = null;
    }
  }

  return async function verifyAppleIdToken(token, { audience, nonce } = {}) {
    const audiences = (Array.isArray(audience) ? audience : [audience])
      .filter((value) => typeof value === 'string' && value.trim());
    if (!audiences.length) throw new Error('Apple OAuth audience not configured');
    if (typeof token !== 'string' || token.length > 16384) throw invalidToken();

    let header;
    try {
      header = jwt.decode(token, { complete: true })?.header;
    } catch {
      throw invalidToken();
    }
    if (header?.alg !== 'RS256' || typeof header?.kid !== 'string' || !header.kid) {
      throw invalidToken();
    }

    const selectKey = () => keys.find((key) =>
      key.kid === header.kid && key.kty === 'RSA' &&
      key.alg === 'RS256' && key.use === 'sig'
    );
    if (fetchedAt === null || now() - fetchedAt >= CACHE_MS) await refresh();
    let jwk = selectKey();
    // Allow key rotation while bounding refreshes for unknown attacker-supplied kids.
    if (!jwk && now() - fetchedAt >= REFRESH_COOLDOWN_MS) {
      await refresh();
      jwk = selectKey();
    }
    if (!jwk) throw invalidToken();

    let claims;
    try {
      claims = jwt.verify(token, createPublicKey({ key: jwk, format: 'jwk' }), {
        algorithms: ['RS256'],
        issuer: ISSUER,
        audience: audiences,
        clockTimestamp: Math.floor(now() / 1000),
      });
    } catch {
      throw invalidToken();
    }
    if (!claims || typeof claims !== 'object' ||
        typeof claims.sub !== 'string' || !claims.sub.trim() ||
        !Number.isFinite(claims.exp)) {
      throw invalidToken();
    }

    // Native clients may send the raw nonce or the SHA-256 value passed to
    // Apple. This checks the supplied nonce; server-issued replay protection
    // requires a separate authentication challenge/session flow.
    if (nonce !== undefined && nonce !== null) {
      if (typeof nonce !== 'string' || !nonce || nonce.length > 1024 ||
          typeof claims.nonce !== 'string') throw invalidToken();
      const digest = createHash('sha256').update(nonce, 'utf8').digest('hex');
      if (!sameString(claims.nonce, nonce) && !sameString(claims.nonce, digest)) {
        throw invalidToken();
      }
    }
    return claims;
  };
}

export const verifyAppleIdToken = createAppleTokenVerifier({
  fetchKeys: async () => {
    const { data } = await axios.get(`${ISSUER}/auth/keys`, {
      timeout: 10000,
      maxRedirects: 0,
      maxContentLength: 65536,
    });
    return data?.keys;
  },
});
