import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import {
  copyFileSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { join, resolve } from 'node:path';
import { PrismaClient } from '@prisma/client';

import { artifacts, freshCluster } from './staff-fresh-postgres.mjs';
import { runPreflight } from './staff-deployment-preflight.mjs';

// New cluster only: never accepts an existing database, archive or data directory.
// Exercise a populated pre-PR schema upgrade, not another empty-schema/browser run.
const cluster = await freshCluster('source');
const database = 'chatforia_room_settings_test';
const clients = [];
const checks = [];
let postgresVersion;
const pass = (name) => {
  checks.push(name);
  console.log('PASS:', name);
};
const client = (role) => {
  const db = new PrismaClient({
    log: [],
    datasources: { db: { url: cluster.url(database, role) } },
  });
  clients.push(db);
  return db;
};
const env = {
  STAFF_EXPECTED_DATABASE: database,
  STAFF_SECURITY_ENABLED: 'true',
  STAFF_DASHBOARD_ENABLED: 'false',
  NODE_ENV: 'production',
  STAFF_ACCESS_SIGNING_SECRET: randomBytes(32).toString('hex'),
  JWT_SECRET: randomBytes(32).toString('hex'),
  APP_ENC_KEY: randomBytes(32).toString('base64'),
};
try {
  const prismaDirectory = join(artifacts, 'upgrade');
  mkdirSync(join(prismaDirectory, 'migrations'), {
    recursive: true,
    mode: 0o700,
  });
  copyFileSync(
    'server/prisma/schema.prisma',
    join(prismaDirectory, 'schema.prisma')
  );
  copyFileSync(
    'server/prisma/migrations/migration_lock.toml',
    join(prismaDirectory, 'migrations/migration_lock.toml')
  );
  // Rehearse the pinned staff release window. Later application migrations
  // have their own QA and must not be folded into its 141/160-file history.
  const staffReleaseLastMigration = '20261102094000_founder_staff_management';
  const names = readdirSync('server/prisma/migrations')
    .filter((name) => /^\d/.test(name) && name <= staffReleaseLastMigration)
    .sort();
  const staffNames = new Set(
    JSON.parse(
      readFileSync('docs/staff-security/deployment-migrations.json')
    ).migrations.map(({ name }) => name)
  );
  assert.equal(names.length, 160);
  assert.ok([...staffNames].every((name) => names.includes(name)));
  const copyMigration = (name) => {
    const target = join(prismaDirectory, 'migrations', name);
    mkdirSync(target, { mode: 0o700 });
    copyFileSync(
      `server/prisma/migrations/${name}/migration.sql`,
      join(target, 'migration.sql')
    );
  };
  const migrate = () => {
    const output = execFileSync(
      process.execPath,
      [
        resolve('node_modules/prisma/build/index.js'),
        'migrate',
        'deploy',
        '--schema',
        join(prismaDirectory, 'schema.prisma'),
      ],
      {
        cwd: prismaDirectory,
        env: {
          PATH: process.env.PATH,
          LC_ALL: 'C',
          DATABASE_URL: cluster.url(database, 'staff_migration_probe'),
          PRISMA_HIDE_UPDATE_MESSAGE: 'true',
          CHECKPOINT_DISABLE: '1',
        },
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      }
    );
    assert.match(output, /All migrations have been successfully applied/);
  };
  cluster.sql(
    'postgres',
    `CREATE ROLE staff_migration_probe LOGIN NOSUPERUSER CREATEDB CREATEROLE;
    CREATE DATABASE ${database} OWNER staff_migration_probe;`
  );
  const executor = client('staff_migration_probe');
  const [engine] = await executor.$queryRaw`
    SELECT current_setting('server_version') AS version`;
  postgresVersion = engine.version;
  await assert.rejects(
    runPreflight(executor, env, '--before-migrations'),
    /prerequisites/
  );
  pass('missing bootstrap roles/schema fail before migrations');
  cluster.sql(
    database,
    `SET SESSION AUTHORIZATION staff_migration_probe;
    ${readFileSync('server/scripts/staff-ci-bootstrap.sql', 'utf8')}
    CREATE ROLE chatforia_staff_owner NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
    GRANT chatforia_staff_owner TO staff_migration_probe WITH SET TRUE;
    ${readFileSync('server/scripts/staff-access-bootstrap-role.sql', 'utf8')}`
  );
  for (const name of names.filter((name) => !staffNames.has(name)))
    copyMigration(name);
  assert.equal(names.length - staffNames.size, 141);
  migrate();
  await executor.user.createMany({
    data: [
      {
        id: 1,
        username: 'upgrade_admin',
        role: 'ADMIN',
        tokenVersion: 9,
        passwordHash: 'synthetic-unusable',
      },
      {
        id: 2,
        username: 'upgrade_user',
        displayName: 'Keep this value',
        passwordHash: 'synthetic-unusable',
      },
    ],
  });
  const before = await executor.user.findMany({ orderBy: { id: 'asc' } });
  await runPreflight(executor, env, '--before-migrations');
  pass(
    'populated 141-migration baseline passes read-only prerequisites as non-superuser'
  );
  const [originalMigration] = await executor.$queryRaw`
    SELECT migration_name, checksum FROM public._prisma_migrations ORDER BY migration_name LIMIT 1`;
  await executor.$executeRaw`UPDATE public._prisma_migrations SET checksum='synthetic-drift'
    WHERE migration_name=${originalMigration.migration_name}`;
  await assert.rejects(
    runPreflight(executor, env, '--before-migrations'),
    /Migration history/
  );
  await executor.$executeRaw`UPDATE public._prisma_migrations SET checksum=${originalMigration.checksum}
    WHERE migration_name=${originalMigration.migration_name}`;
  pass('baseline migration checksum drift blocks upgrade');
  await assert.rejects(
    runPreflight(
      executor,
      { ...env, STAFF_EXPECTED_DATABASE: 'wrong_target' },
      '--before-migrations'
    ),
    /identity/
  );
  pass('wrong expected database fails closed');
  cluster.sql(database, 'CREATE EXTENSION pgcrypto WITH SCHEMA public');
  await assert.rejects(
    runPreflight(executor, env, '--before-migrations'),
    /pgcryptoNamespaceCompatible/
  );
  cluster.sql(database, 'ALTER EXTENSION pgcrypto SET SCHEMA staff_security');
  pass(
    'pre-existing pgcrypto in public is detected before any staff migration'
  );
  cluster.sql(
    database,
    'CREATE TABLE public.synthetic_owner_probe(id integer); ALTER TABLE public.synthetic_owner_probe OWNER TO chatforia_dev'
  );
  await assert.rejects(
    runPreflight(executor, env, '--before-migrations'),
    /noRuntimeOwnership/
  );
  cluster.sql(database, 'DROP TABLE public.synthetic_owner_probe');
  pass('runtime object ownership is rejected');
  cluster.sql(database, 'GRANT chatforia_staff_owner TO chatforia_dev');
  await assert.rejects(
    runPreflight(executor, env, '--before-migrations'),
    /noPrivilegedMembership/
  );
  cluster.sql(database, 'REVOKE chatforia_staff_owner FROM chatforia_dev');
  pass('runtime SET ROLE membership is rejected even with NOINHERIT');
  await runPreflight(executor, env, '--before-migrations');
  for (const name of names.filter((name) => staffNames.has(name)))
    copyMigration(name);
  migrate();
  assert.deepEqual(
    await executor.user.findMany({ orderBy: { id: 'asc' } }),
    before
  );
  const [history] =
    await executor.$queryRaw`SELECT count(*)::integer AS count FROM public._prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL`;
  assert.equal(history.count, 160);
  await assert.rejects(
    runPreflight(executor, env, '--before-migrations'),
    /Migration history/
  );
  pass(
    'all 19 staff migrations upgrade populated baseline without changing existing users'
  );
  const runtime = client('chatforia_dev');
  await assert.rejects(
    runPreflight(runtime, env, '--runtime'),
    /does not match/
  );
  // Only the verified new cluster's DBA provisions this generated test key.
  const admin = client(cluster.admin);
  await admin.$executeRaw`INSERT INTO staff_security.assertion_secrets(id,key_version,verification_secret)
    VALUES (1,1,convert_to(${env.STAFF_ACCESS_SIGNING_SECRET},'UTF8'))`;
  await runPreflight(runtime, env, '--runtime');
  await assert.rejects(
    runPreflight(
      runtime,
      { ...env, STAFF_SECURITY_ENABLED: 'false' },
      '--runtime'
    ),
    /enable staff security/
  );
  await assert.rejects(
    runPreflight(
      runtime,
      { ...env, STAFF_ACCESS_SIGNING_SECRET: 'wrong'.repeat(16) },
      '--runtime'
    ),
    /does not match/
  );
  pass(
    'post-migration gate requires security enabled and matching independent signing key'
  );
  await runtime.user.update({
    where: { id: 2 },
    data: { displayName: 'Ordinary write still works' },
  });
  await assert.rejects(
    runtime.user.update({
      where: { id: 1 },
      data: { passwordHash: 'forbidden' },
    })
  );
  assert.equal(
    (await runtime.user.findUnique({ where: { id: 1 } })).tokenVersion,
    9
  );
  pass('existing administrator protection and ordinary writes survive upgrade');
  await runPreflight(
    runtime,
    { ...env, STAFF_DASHBOARD_ENABLED: 'true', STAFF_DASHBOARD_USER_IDS: '1' },
    '--runtime'
  );
  await runPreflight(runtime, env, '--runtime');
  pass(
    'canary and dashboard-disabled containment configurations both retain security readiness'
  );
} finally {
  try {
    for (const db of clients) await db.$disconnect();
  } finally {
    cluster.stop();
  }
}
writeFileSync(
  '/tmp/chatforia-staff-deployment-report.json',
  JSON.stringify(
    {
      syntheticOnly: true,
      postgresVersion,
      checks,
      total: checks.length,
      clusterStopped: true,
      baselineMigrations: 141,
      addedMigrations: 19,
      totalMigrations: 160,
      browserQaRepeated: false,
      existingDatabaseUsed: false,
    },
    null,
    2
  )
);
