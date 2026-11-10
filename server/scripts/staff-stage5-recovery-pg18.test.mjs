import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { PrismaClient } from '@prisma/client';
import { runRecoverySequence } from './staff-stage5-recovery-sequence.mjs';
import { stage5RecoveryPreflight } from './staff-stage5-recovery-preflight.mjs';
import { loadStage5RecoveryManifest } from './staff-stage5-recovery-history.mjs';
import { buildPackage } from './migration-package.mjs';

// Run only with a disposable postgres:18.6 container sharing this process's
// loopback network. No caller-supplied database, host, or existing data.
assert.equal(process.env.STAFF_STAGE5_SYNTHETIC_PG18, 'yes');
const url = new URL(process.env.DATABASE_URL);
assert.equal(url.hostname, '127.0.0.1');
assert.equal(url.port, '5432');
assert.equal(url.pathname, '/defaultdb');
assert.equal(url.username, 'doadmin_probe');
assert.equal(url.password, '');
const db = new PrismaClient({
  datasources: { db: { url: url.toString() } },
  log: [],
});
const root = mkdtempSync(join(tmpdir(), 'staff-stage5-recovery-'));
const prismaDir = join(root, 'prisma');
const migrationDir = join(prismaDir, 'migrations');
mkdirSync(migrationDir, { recursive: true, mode: 0o700 });
copyFileSync('server/prisma/schema.prisma', join(prismaDir, 'schema.prisma'));
copyFileSync(
  'server/prisma/migrations/migration_lock.toml',
  join(migrationDir, 'migration_lock.toml')
);
const names = readdirSync('server/prisma/migrations')
  .filter((name) => /^\d/.test(name))
  .sort();
assert.equal(names.length, 161);
const baseline = names.filter((name) => name < '20261102');
assert.equal(baseline.length, 141);
const add = (name) => {
  const destination = join(migrationDir, name);
  mkdirSync(destination, { mode: 0o700 });
  copyFileSync(
    `server/prisma/migrations/${name}/migration.sql`,
    join(destination, 'migration.sql')
  );
};
const cli = (...args) =>
  execFileSync(
    process.execPath,
    [
      resolve('node_modules/prisma/build/index.js'),
      'migrate',
      ...args,
      '--schema',
      join(prismaDir, 'schema.prisma'),
    ],
    {
      cwd: process.cwd(),
      env: { ...process.env, PRISMA_HIDE_UPDATE_MESSAGE: 'true' },
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 900000,
    }
  );
const ledger = () =>
  db.$queryRawUnsafe(
    'SELECT id, migration_name, checksum, finished_at, rolled_back_at, logs FROM public._prisma_migrations ORDER BY migration_name, started_at, id'
  );
const counts = (rows) => ({
  active: rows.filter((row) => row.finished_at && !row.rolled_back_at).length,
  rolledBack: rows.filter((row) => row.rolled_back_at).length,
  unfinished: rows.filter((row) => !row.finished_at && !row.rolled_back_at)
    .length,
});
try {
  const [fixture] = await db.$queryRawUnsafe(`SELECT
    current_setting('server_version_num')::integer = 180006 AS pg18_6,
    current_database() = 'defaultdb' AND current_user = 'doadmin_probe' AS identity,
    (SELECT count(*) = 0 FROM pg_tables WHERE schemaname='public') AS empty_public,
    (SELECT count(*) = 0 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='staff_security' AND c.relkind IN ('r','p','v','m','S')) AS empty_staff,
    to_regclass('public._prisma_migrations') IS NULL AS no_ledger,
    (SELECT r.rolname='doadmin_probe' FROM pg_database d JOIN pg_roles r ON r.oid=d.datdba
      WHERE d.datname=current_database()) AS owned_by_probe`);
  assert.deepEqual(fixture, {
    pg18_6: true,
    identity: true,
    empty_public: true,
    empty_staff: true,
    no_ledger: true,
    owned_by_probe: true,
  });
  for (const name of baseline) add(name);
  cli('deploy');
  assert.deepEqual(counts(await ledger()), {
    active: 141,
    rolledBack: 0,
    unfinished: 0,
  });
  await db.$executeRawUnsafe(`INSERT INTO public."User"
    (username, "passwordHash", email, "tokenVersion") VALUES
    ('stage5_synthetic_one', 'synthetic-unusable-hash', 'one@example.invalid', 0),
    ('stage5_synthetic_two', 'synthetic-unusable-hash', 'two@example.invalid', 7)`);
  const userSnapshot = () =>
    db.$queryRawUnsafe(
      'SELECT to_jsonb(u) AS row FROM public."User" u ORDER BY id'
    );
  const preservedUsers = await userSnapshot();
  // Recreate the recorded target history, without customer data.
  const manifest = JSON.parse(
    (await import('node:fs')).readFileSync(
      'server/security/staffMigrationReconciliation.v2.json'
    )
  );
  for (const [name, pair] of Object.entries(manifest.exceptions)) {
    await db.$executeRawUnsafe(
      'UPDATE public._prisma_migrations SET checksum=$1 WHERE migration_name=$2',
      pair.recordedChecksum,
      name
    );
  }
  for (let i = 0; i < 3; i++) {
    await db.$executeRawUnsafe(
      `INSERT INTO public._prisma_migrations
      (id, checksum, migration_name, started_at, rolled_back_at, applied_steps_count)
      VALUES ($1,$2,$3,now(),now(),0)`,
      `00000000-0000-0000-0000-${String(i + 201).padStart(12, '0')}`,
      'e'.repeat(64),
      baseline[i]
    );
  }
  const first = names.filter((name) => name.startsWith('20261102')).slice(0, 3);
  assert.deepEqual(first, [
    '20261102060000_add_staff_access',
    '20261102061000_add_founder_ownership',
    '20261102070000_staff_security_foundation',
  ]);
  for (const name of first) add(name);
  assert.throws(() => cli('deploy'));
  const failed = await ledger();
  assert.deepEqual(counts(failed), {
    active: 143,
    rolledBack: 3,
    unfinished: 1,
  });
  assert.match(
    failed.find((row) => row.migration_name === first[2] && !row.rolled_back_at)
      .logs,
    /Required staff_security schema has not been provisioned/
  );
  const [before] = await db.$queryRawUnsafe(`SELECT
    (SELECT count(*)::int FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='staff_security' AND c.relkind IN ('r','v','m','S','p')) AS objects,
    (SELECT count(*)::int FROM public."StaffAssignment") AS assignments,
    (SELECT count(*)::int FROM public."StaffAccessEvent") AS events,
    (SELECT count(*)::int FROM public."FounderOwnership") AS founders,
    has_schema_privilege(current_user,'staff_security','USAGE') AS usage,
    has_schema_privilege(current_user,'staff_security','CREATE') AS create`);
  assert.deepEqual(before, {
    objects: 0,
    assignments: 0,
    events: 0,
    founders: 0,
    usage: false,
    create: false,
  });
  console.log(
    'PASS: exact 143/3/1 failure reproduced; no foundation objects or synthetic staff rows'
  );
  if (process.env.STAFF_STAGE5_STOP_AFTER_FAILURE === 'yes') {
    console.log(
      'PASS: stopped at synthetic recovery checkpoint for guarded SQL-script test'
    );
    process.exit(0);
  }

  const recoveryManifest = structuredClone(loadStage5RecoveryManifest());
  const failedRow = failed.find(
    (row) => !row.finished_at && !row.rolled_back_at
  );
  const shape = (row) => ({
    id: row.id,
    name: row.migration_name,
    checksum: row.checksum,
  });
  recoveryManifest.failedMigration = shape(failedRow);
  recoveryManifest.completedNewMigrations =
    recoveryManifest.completedNewMigrations.map((entry) =>
      shape(
        failed.find(
          (row) => row.migration_name === entry.name && row.finished_at
        )
      )
    );
  recoveryManifest.preexistingRolledBackRows = failed
    .filter((row) => row.rolled_back_at)
    .map(shape);
  const bundle = buildPackage(recoveryManifest.releaseCommit);
  const phase = async (name) => {
    try {
      const result = await stage5RecoveryPreflight(
        db,
        bundle,
        recoveryManifest,
        name,
        { executorRole: 'doadmin_probe' }
      );
      assert.equal(result.preserveUserCount, '2');
    } finally {
      await db.$disconnect();
    }
  };
  const guarded = async (operation) => {
    await db.$disconnect();
    // The only fixture substitutions are the synthetic login and generated ID.
    const source = readFileSync(
      `server/scripts/staff-stage5-recovery-${operation}-executor-inherit.sql`,
      'utf8'
    );
    const sql = source
      .replace(/\bdoadmin\b/g, 'doadmin_probe')
      .replace(loadStage5RecoveryManifest().failedMigration.id, failedRow.id);
    const file = join(root, `${operation}.sql`);
    writeFileSync(file, sql, { mode: 0o600 });
    execFileSync('psql', ['-X', '-w', '-v', 'ON_ERROR_STOP=1', '-f', file], {
      env: {
        ...process.env,
        PGHOST: url.hostname,
        PGPORT: url.port,
        PGDATABASE: 'defaultdb',
        PGUSER: 'doadmin_probe',
        PGSSLMODE: 'disable',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 90000,
    });
  };
  await phase('failed');
  // Test the actual enable guard with a separately held executor session.
  const other = new PrismaClient({
    datasources: { db: { url: url.toString() } },
    log: [],
  });
  try {
    await other.$queryRawUnsafe('SELECT 1');
    await assert.rejects(guarded('enable'));
  } finally {
    await other.$disconnect();
  }
  // A post-cleanup invariant failure must NOT roll back removal of inheritance.
  await guarded('enable');
  await db.$executeRawUnsafe('GRANT chatforia_staff_owner TO chatforia_dev');
  await assert.rejects(guarded('disable'));
  const [cleaned] = await db.$queryRawUnsafe(`SELECT NOT EXISTS (
    SELECT FROM pg_auth_members m JOIN pg_roles r ON r.oid=m.roleid
    JOIN pg_roles u ON u.oid=m.member WHERE r.rolname='chatforia_staff_owner'
    AND u.rolname='doadmin_probe' AND m.inherit_option) AS removed`);
  assert.equal(cleaned.removed, true);
  await db.$executeRawUnsafe('REVOKE chatforia_staff_owner FROM chatforia_dev');
  await guarded('disable');
  await guarded('disable'); // Idempotent, including when enable never committed.
  // Exercise the shared runner's failure path against real guarded SQL.
  await assert.rejects(
    runRecoverySequence({
      failed: () => phase('failed'),
      beforeEnable: async () => {},
      enable: () => guarded('enable'),
      resolve: async () => {
        throw new Error('Injected failure before resolve');
      },
      disable: () => guarded('disable'),
    }),
    /cleanup passed/
  );
  await phase('failed');
  for (const name of names.filter(
    (name) => !baseline.includes(name) && !first.includes(name)
  ))
    add(name);
  const fault = process.env.STAFF_STAGE5_FAILURE_AT || 'none';
  assert.ok(['none', 'after-resolve', 'during-deploy'].includes(fault));
  if (fault === 'during-deploy') {
    // Fault only the disposable copy; all repository migration SQL stays intact.
    writeFileSync(
      join(migrationDir, '20261102071000_install_staff_pgcrypto/migration.sql'),
      "DO $$ BEGIN RAISE EXCEPTION 'Synthetic migration failure'; END $$;\n"
    );
  }
  const recovery = runRecoverySequence({
    failed: () => phase('failed'),
    beforeEnable: async () => {},
    enable: () => guarded('enable'),
    resolve: async () => {
      cli('resolve', '--rolled-back', first[2]);
    },
    resolved: async () => {
      await phase('resolved');
      if (fault === 'after-resolve')
        throw new Error('Injected resolved-gate failure');
    },
    beforeDeploy: async () => {},
    deploy: async () => {
      cli('deploy');
    },
    disable: () => guarded('disable'),
    complete: () => phase('complete'),
  });
  if (fault !== 'none') {
    await assert.rejects(recovery, /cleanup passed/);
    assert.deepEqual(await userSnapshot(), preservedUsers);
    assert.deepEqual(counts(await ledger()), {
      active: fault === 'during-deploy' ? 144 : 143,
      rolledBack: 4,
      unfinished: fault === 'during-deploy' ? 1 : 0,
    });
    await guarded('disable');
    const [rights] = await db.$queryRawUnsafe(
      "SELECT has_schema_privilege(current_user,'staff_security','USAGE') AS usage"
    );
    assert.equal(rights.usage, false);
    console.log(
      `PASS: ${fault} leaves partial ledger untouched and executor inheritance removed`
    );
  } else {
    await recovery;
    assert.deepEqual(await userSnapshot(), preservedUsers);
    const completedRows = await ledger();
    assert.deepEqual(counts(completedRows), {
      active: 161,
      rolledBack: 4,
      unfinished: 0,
    });
    const preserved = completedRows.find((row) => row.id === failedRow.id);
    assert.ok(preserved.rolled_back_at);
    assert.equal(preserved.checksum, failedRow.checksum);
    assert.equal(preserved.logs, failedRow.logs);
    await guarded('disable');
    const [final] = await db.$queryRawUnsafe(`SELECT
    has_schema_privilege(current_user,'staff_security','USAGE') AS usage,
    has_schema_privilege(current_user,'staff_security','CREATE') AS create,
    has_schema_privilege('chatforia_dev','staff_security','CREATE') AS runtime_create,
    pg_has_role('chatforia_dev','chatforia_staff_owner','MEMBER') AS runtime_owner_member,
    has_table_privilege('chatforia_dev','public."StaffAssignment"','UPDATE') AS runtime_assignment_update,
    has_table_privilege('chatforia_dev','public."StaffAccessEvent"','INSERT') AS runtime_staff_event_insert,
    has_column_privilege('chatforia_dev','public."User"','role','UPDATE') AS runtime_role_update,
    (SELECT count(*)::int FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      JOIN pg_roles r ON r.oid=c.relowner WHERE n.nspname='staff_security'
      AND c.relkind IN ('r','p') AND r.rolname='chatforia_staff_owner') AS owner_tables,
    (SELECT count(*)::int FROM pg_auth_members m JOIN pg_roles r ON r.oid=m.roleid
      JOIN pg_roles u ON u.oid=m.member WHERE r.rolname='chatforia_staff_owner'
      AND u.rolname='doadmin_probe') AS owner_edges`);
    assert.equal(final.usage, false);
    assert.equal(final.create, false);
    assert.equal(final.runtime_create, false);
    assert.equal(final.runtime_owner_member, false);
    assert.equal(final.runtime_assignment_update, false);
    assert.equal(final.runtime_staff_event_insert, false);
    assert.equal(final.runtime_role_update, false);
    assert.ok(final.owner_tables >= 3);
    assert.equal(final.owner_edges, 2);
    console.log(
      'PASS: 161/4/0 full sequence, failed row preserved, narrow grant revoked, runtime CREATE denied'
    );
  }
} finally {
  await db.$disconnect();
}
