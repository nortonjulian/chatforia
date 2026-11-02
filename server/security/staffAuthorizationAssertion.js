import crypto from 'node:crypto';

export const STAFF_ASSERTION_LIFETIME_SECONDS = 60;

export const STAFF_ASSERTION_ISSUER = 'chatforia-staff-access';
export const STAFF_ASSERTION_AUDIENCE = 'chatforia-staff-database';

const ALLOWED_ACTIONS = new Set([
  'STAFF_ACCESS_GRANT_OR_CHANGE',
  'STAFF_ACCESS_REVOKE',
]);

const ALLOWED_PROFILES = new Set([
  'CTO',
  'ENGINEERING_MANAGER',
  'SENIOR_ENGINEER',
  'SUPPORT',
  'ACCESS_ADMIN',
]);

function validId(value) {
  return Number.isSafeInteger(value) && value > 0;
}

function validSecret(secret) {
  return (
    typeof secret === 'string' &&
    Buffer.byteLength(secret, 'utf8') >= 32
  );
}

function validateClaims(claims, nowSeconds) {
  if (
    !claims ||
    typeof claims !== 'object' ||
    Array.isArray(claims)
  ) {
    return false;
  }

  if (
    claims.iss !== STAFF_ASSERTION_ISSUER ||
    claims.aud !== STAFF_ASSERTION_AUDIENCE ||
    claims.typ !== 'staff_authorization'
  ) {
    return false;
  }

  if (
    !validId(claims.actorUserId) ||
    !validId(claims.targetUserId) ||
    claims.actorUserId === claims.targetUserId
  ) {
    return false;
  }

  if (
    !Number.isSafeInteger(claims.tokenVersion) ||
    claims.tokenVersion < 0 ||
    claims.mfaVerified !== true
  ) {
    return false;
  }

  if (!ALLOWED_ACTIONS.has(claims.action)) {
    return false;
  }

  if (!ALLOWED_PROFILES.has(claims.targetProfile)) {
    return false;
  }

  if (
    claims.action === 'STAFF_ACCESS_REVOKE' &&
    !claims.targetProfile
  ) {
    return false;
  }

  if (
    typeof claims.jti !== 'string' ||
    !/^[a-f0-9-]{36}$/i.test(claims.jti)
  ) {
    return false;
  }

  if (
    !Number.isSafeInteger(claims.iat) ||
    !Number.isSafeInteger(claims.exp) ||
    claims.iat > nowSeconds + 5 ||
    claims.exp <= nowSeconds ||
    claims.exp <= claims.iat ||
    claims.exp - claims.iat >
      STAFF_ASSERTION_LIFETIME_SECONDS
  ) {
    return false;
  }

  return true;
}

function signatureFor(secret, encodedPayload) {
  return crypto
    .createHmac('sha256', secret)
    .update(encodedPayload, 'utf8')
    .digest();
}

export function createStaffAuthorizationAssertion(
  {
    actorUserId,
    targetUserId,
    action,
    targetProfile,
    tokenVersion,
    mfaVerified,
  },
  {
    secret = process.env.STAFF_ACCESS_SIGNING_SECRET,
    nowSeconds = Math.floor(Date.now() / 1000),
  } = {}
) {
  if (!validSecret(secret)) {
    throw new Error(
      'STAFF_ACCESS_SIGNING_SECRET must contain at least 32 bytes.'
    );
  }

  if (mfaVerified !== true) {
    throw new Error('MFA verification is required.');
  }

  const claims = {
    iss: STAFF_ASSERTION_ISSUER,
    aud: STAFF_ASSERTION_AUDIENCE,
    typ: 'staff_authorization',
    actorUserId,
    targetUserId,
    action,
    targetProfile,
    tokenVersion,
    mfaVerified,
    jti: crypto.randomUUID(),
    iat: nowSeconds,
    exp: nowSeconds + STAFF_ASSERTION_LIFETIME_SECONDS,
  };

  if (!validateClaims(claims, nowSeconds)) {
    throw new Error('Invalid staff authorization assertion claims.');
  }

  const encodedPayload = Buffer
    .from(JSON.stringify(claims), 'utf8')
    .toString('base64url');

  const signature = signatureFor(secret, encodedPayload)
    .toString('base64url');

  return `${encodedPayload}.${signature}`;
}

export function verifyStaffAuthorizationAssertion(
  token,
  {
    secret = process.env.STAFF_ACCESS_SIGNING_SECRET,
    nowSeconds = Math.floor(Date.now() / 1000),
  } = {}
) {
  try {
    if (
      !validSecret(secret) ||
      typeof token !== 'string' ||
      token.length > 4096
    ) {
      return null;
    }

    const parts = token.split('.');

    if (
      parts.length !== 2 ||
      !parts[0] ||
      !parts[1] ||
      !/^[A-Za-z0-9_-]+$/.test(parts[0]) ||
      !/^[A-Za-z0-9_-]+$/.test(parts[1])
    ) {
      return null;
    }

    const [encodedPayload, encodedSignature] = parts;

    const suppliedSignature = Buffer.from(
      encodedSignature,
      'base64url'
    );

    const expectedSignature = signatureFor(
      secret,
      encodedPayload
    );

    if (
      suppliedSignature.length !== expectedSignature.length ||
      !crypto.timingSafeEqual(
        suppliedSignature,
        expectedSignature
      )
    ) {
      return null;
    }

    const claims = JSON.parse(
      Buffer.from(encodedPayload, 'base64url').toString('utf8')
    );

    if (!validateClaims(claims, nowSeconds)) {
      return null;
    }

    return claims;

  } catch {
    return null;
  }
}
