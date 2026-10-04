// Only an explicitly selected, disposable PostgreSQL test database is allowed.
export function getTestDatabaseTarget() {
  if (process.env.NODE_ENV !== 'test') {
    throw new Error('Database test helpers require NODE_ENV=test');
  }
  const raw = process.env.TEST_DATABASE_URL;
  if (!raw) {
    throw new Error('Set TEST_DATABASE_URL to a dedicated, migrated test database before running Jest.');
  }
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error('TEST_DATABASE_URL must be a valid PostgreSQL URL');
  }
  if (!['postgres:', 'postgresql:'].includes(parsed.protocol)) {
    throw new Error('TEST_DATABASE_URL must use PostgreSQL');
  }
  const database = decodeURIComponent(parsed.pathname.slice(1));
  if (!/(^|_)test($|_)/i.test(database)) {
    throw new Error('The disposable database name must contain a separate test segment, such as chatforia_auth_test.');
  }
  const schema = parsed.searchParams.get('schema') || 'public';
  return { raw, database, schema };
}

export function assertTestDatabaseSelected() {
  const target = getTestDatabaseTarget();
  if (process.env.DATABASE_URL !== target.raw) {
    throw new Error('DATABASE_URL must equal TEST_DATABASE_URL before test database access');
  }
  return target;
}
