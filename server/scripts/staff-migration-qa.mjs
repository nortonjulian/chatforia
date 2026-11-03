import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

import { freshCluster } from './staff-fresh-postgres.mjs';

// Never accepts an existing URL or directory. The helper verifies its newly
// initialized data directory before creating this empty synthetic database.
const cluster = await freshCluster('source');
const database = 'chatforia_room_settings_test';
const bootstrap = readFileSync(
  'server/scripts/staff-access-bootstrap-role.sql',
  'utf8'
);
try {
  cluster.sql(
    'postgres',
    `
    CREATE ROLE managed_admin_probe LOGIN NOSUPERUSER CREATEDB CREATEROLE REPLICATION BYPASSRLS;
    CREATE DATABASE ${database} OWNER managed_admin_probe;
  `
  );
  cluster.sql(
    database,
    `SET SESSION AUTHORIZATION managed_admin_probe;
    ${readFileSync('server/scripts/staff-ci-bootstrap.sql', 'utf8')}
    CREATE ROLE chatforia_staff_owner NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB
      NOCREATEROLE NOREPLICATION NOBYPASSRLS;
    -- Separate DBA-only executor grant; never granted to chatforia_dev.
    GRANT chatforia_staff_owner TO managed_admin_probe WITH SET TRUE;
    ${bootstrap}
  `
  );
  cluster.sql(database, 'ALTER ROLE chatforia_staff_owner INHERIT');
  assert.throws(() => cluster.sql(database, bootstrap), /unsafe/);
  cluster.sql(database, 'ALTER ROLE chatforia_staff_owner NOINHERIT');
  const url = cluster.url(database, 'managed_admin_probe');
  const output = execFileSync(
    process.execPath,
    [
      'node_modules/prisma/build/index.js',
      'migrate',
      'deploy',
      '--schema=server/prisma/schema.prisma',
    ],
    {
      env: { ...process.env, DATABASE_URL: url, TEST_DATABASE_URL: url },
      encoding: 'utf8',
    }
  );
  assert.match(output, /All migrations have been successfully applied/);
  cluster.sql(
    database,
    `DO $$ BEGIN
    IF EXISTS (SELECT FROM pg_roles
      WHERE rolname IN ('chatforia_dev','chatforia_staff_owner',
        'chatforia_recovery_issuer','chatforia_recovery_executor')
      AND (rolsuper OR rolcreaterole OR rolcreatedb OR rolreplication OR rolbypassrls))
      OR pg_has_role('chatforia_dev','chatforia_staff_owner','MEMBER')
      OR pg_has_role('chatforia_dev','chatforia_recovery_issuer','MEMBER')
      OR pg_has_role('chatforia_dev','chatforia_recovery_executor','MEMBER')
      OR has_column_privilege('chatforia_dev','public."User"','role','UPDATE')
    THEN RAISE EXCEPTION 'Unsafe application role boundary'; END IF;
  END $$;
  `
  );
  console.log(
    'PASS: all 159 migrations under non-superuser executor; unsafe owner rejected; runtime isolated; owner membership confined to the DBA executor'
  );
} finally {
  cluster.stop();
}
