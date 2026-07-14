import { google } from 'googleapis';
import { ENV } from '../config/env.js';

const VALID_GOOGLE_ISSUERS = new Set([
  'accounts.google.com',
  'https://accounts.google.com',
]);

let oidcClient = null;

function getOidcClient() {
  if (!oidcClient) {
    oidcClient = new google.auth.OAuth2();
  }

  return oidcClient;
}

function createAuthError(
  message,
  statusCode,
  code
) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  return error;
}

function normalizeEmail(value) {
  return String(value || '')
    .trim()
    .toLowerCase();
}

export function extractBearerToken(req) {
  const authorization =
    String(req?.headers?.authorization || '').trim();

  const match =
    /^Bearer\s+([^\s]+)$/i.exec(authorization);

  return match?.[1] ?? null;
}

export async function verifyGooglePlayRtdnRequest(
  req,
  {
    client = getOidcClient(),
    audience =
      ENV.GOOGLE_PLAY_RTDN_AUDIENCE,
    expectedServiceAccountEmail =
      ENV.GOOGLE_PLAY_RTDN_SERVICE_ACCOUNT_EMAIL,
  } = {}
) {
  const normalizedAudience =
    String(audience || '').trim();

  const normalizedExpectedEmail =
    normalizeEmail(expectedServiceAccountEmail);

  if (
    !normalizedAudience ||
    !normalizedExpectedEmail
  ) {
    throw createAuthError(
      'Google Play RTDN authentication is not configured.',
      503,
      'GOOGLE_PLAY_RTDN_NOT_CONFIGURED'
    );
  }

  const idToken = extractBearerToken(req);

  if (!idToken) {
    throw createAuthError(
      'A valid Pub/Sub bearer token is required.',
      401,
      'GOOGLE_PLAY_RTDN_TOKEN_REQUIRED'
    );
  }

  let ticket;

  try {
    ticket = await client.verifyIdToken({
      idToken,
      audience: normalizedAudience,
    });
  } catch {
    throw createAuthError(
      'The Pub/Sub identity token is invalid.',
      401,
      'GOOGLE_PLAY_RTDN_TOKEN_INVALID'
    );
  }

  const payload =
    ticket?.getPayload?.() ?? null;

  if (!payload) {
    throw createAuthError(
      'The Pub/Sub identity token has no payload.',
      401,
      'GOOGLE_PLAY_RTDN_TOKEN_INVALID'
    );
  }

  if (
    !VALID_GOOGLE_ISSUERS.has(
      String(payload.iss || '')
    )
  ) {
    throw createAuthError(
      'The Pub/Sub identity token issuer is invalid.',
      401,
      'GOOGLE_PLAY_RTDN_ISSUER_INVALID'
    );
  }

  if (payload.email_verified !== true) {
    throw createAuthError(
      'The Pub/Sub service-account identity is not verified.',
      401,
      'GOOGLE_PLAY_RTDN_EMAIL_UNVERIFIED'
    );
  }

  const tokenEmail =
    normalizeEmail(payload.email);

  if (
    !tokenEmail ||
    tokenEmail !== normalizedExpectedEmail
  ) {
    throw createAuthError(
      'The Pub/Sub service-account identity is not authorized.',
      403,
      'GOOGLE_PLAY_RTDN_IDENTITY_FORBIDDEN'
    );
  }

  return {
    email: tokenEmail,
    subject: payload.sub ?? null,
    audience: payload.aud ?? null,
    issuer: payload.iss ?? null,
  };
}
