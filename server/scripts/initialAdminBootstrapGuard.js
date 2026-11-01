import { createHash } from 'node:crypto';

/**
 * Environment authorization guard for initial administrator provisioning.
 *
 * Pure validation only: no database connection or writes.
 */

export function validateBootstrapEnvironment({
  nodeEnv,
  databaseUrl,
  expectedDatabase,
  actualDatabase,
  actualSchema,
  confirmation,
  expectedEndpointFingerprint,
}) {
  if (nodeEnv !== 'production') {
    throw new Error('Administrator bootstrap requires production mode');
  }

  if (!databaseUrl) {
    throw new Error('Database connection configuration missing');
  }

  let url;

  try {
    url = new URL(databaseUrl);
  } catch {
    throw new Error('Invalid database connection configuration');
  }

  if (!['postgres:', 'postgresql:'].includes(url.protocol)) {
    throw new Error('Administrator bootstrap requires PostgreSQL');
  }

  const configuredDatabase = decodeURIComponent(
    url.pathname.slice(1)
  );

  if (
    !expectedDatabase ||
    configuredDatabase !== expectedDatabase ||
    actualDatabase !== expectedDatabase ||
    actualSchema !== 'public'
  ) {
    throw new Error('Administrator bootstrap database identity mismatch');
  }

  const endpoint = [
    url.hostname.toLowerCase(),
    url.port || '5432',
    configuredDatabase,
  ].join(':');

  const fingerprint = createHash('sha256')
    .update(endpoint)
    .digest('hex');

  if (
    !expectedEndpointFingerprint ||
    fingerprint !== expectedEndpointFingerprint
  ) {
    throw new Error('Administrator bootstrap endpoint mismatch');
  }

  const expectedConfirmation =
    `PROMOTE julian@chatforia.com ON ${expectedDatabase}`;

  if (confirmation !== expectedConfirmation) {
    throw new Error('Administrator bootstrap confirmation mismatch');
  }

  return {
    authorized: true,
    database: expectedDatabase,
    schema: 'public',
  };
}
