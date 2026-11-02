/**
 * Development sample-data seeding must never target production.
 * This validation performs no database writes or connections.
 */
export function assertDevSeedTarget(env = process.env) {
  if (
    env.NODE_ENV !== 'development' ||
    env.ALLOW_DEV_DATA_SEED !== 'true'
  ) {
    throw new Error(
      'Development seeding requires explicit development authorization.'
    );
  }

  const raw = env.DATABASE_URL;
  const approved = env.DEV_SEED_DATABASE_URL;

  if (!raw || !approved || raw !== approved) {
    throw new Error(
      'DATABASE_URL must match DEV_SEED_DATABASE_URL.'
    );
  }

  let url;

  try {
    url = new URL(raw);
  } catch {
    throw new Error('Invalid development database URL.');
  }

  const database = decodeURIComponent(url.pathname.slice(1));

  if (
    !['postgres:', 'postgresql:'].includes(url.protocol) ||
    !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) ||
    !/(^|_)dev($|_)/i.test(database) ||
    database.toLowerCase() === 'defaultdb'
  ) {
    throw new Error(
      'Development seeding requires a local PostgreSQL development database.'
    );
  }

  return {
    database,
    schema: url.searchParams.get('schema') || 'public',
  };
}


/**
 * Verify the actual connected database before performing seed writes.
 * The supplied Prisma client must be connected to DATABASE_URL.
 */
export async function assertConnectedDevSeedTarget(
  prisma,
  env = process.env
) {
  const expected = assertDevSeedTarget(env);

  const rows = await prisma.$queryRaw`
    SELECT
      current_database() AS database,
      current_schema() AS schema
  `;

  const actual = rows?.[0];

  if (
    actual?.database !== expected.database ||
    actual?.schema !== expected.schema
  ) {
    throw new Error(
      'Connected database identity does not match the approved development seed target.'
    );
  }

  return expected;
}


/**
 * Require an explicitly configured development fixture password.
 * Never log or return this value to an API response.
 */
export function getDevSeedPassword(env = process.env) {
  const password = env.DEV_SEED_PASSWORD;

  if (
    typeof password !== 'string' ||
    password.length < 16 ||
    password.length > 128
  ) {
    throw new Error(
      'DEV_SEED_PASSWORD must contain 16–128 characters.'
    );
  }

  return password;
}
