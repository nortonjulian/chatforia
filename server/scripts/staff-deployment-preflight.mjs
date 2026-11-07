import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

import { assertStaffRuntimeReady } from '../security/staffRuntimeReadiness.js';
import {
  assertReconciliationCatalogAndData,
  assertReconciliationRequested,
  loadReconciliationManifest,
} from '../security/staffMigrationReconciliation.js';
import { migrationSetDigest } from './migration-package.mjs';

class PreflightError extends Error {}

// Catalog-only prerequisite checks AFTER separately approved DBA preparation,
// BEFORE migrations. This tool never creates roles, extensions or schema.
export async function assertDeploymentPrerequisites(db) {
  const [checks] = await db.$queryRaw`
    SELECT
      current_setting('server_version_num')::integer / 10000 IN (16, 18) AS "reviewedPostgresVersion",
      current_user NOT IN ('chatforia_dev', 'chatforia_staff_owner',
        'chatforia_recovery_issuer', 'chatforia_recovery_executor') AS "separateExecutor",
      (SELECT count(*) = 3 FROM pg_roles WHERE rolname IN
        ('chatforia_staff_owner', 'chatforia_recovery_issuer', 'chatforia_recovery_executor')
        AND NOT (rolcanlogin OR rolinherit OR rolsuper OR rolcreatedb OR rolcreaterole
          OR rolreplication OR rolbypassrls)) AS "restrictedOwnersAndOperators",
      EXISTS (SELECT FROM pg_roles WHERE rolname = 'chatforia_dev' AND rolcanlogin
        AND NOT (rolinherit OR rolsuper OR rolcreatedb OR rolcreaterole
          OR rolreplication OR rolbypassrls)) AS "restrictedRuntime",
      NOT EXISTS (SELECT FROM pg_roles owner_role, pg_roles runtime
        WHERE runtime.rolname = 'chatforia_dev'
          AND owner_role.rolname IN ('chatforia_staff_owner', 'chatforia_recovery_issuer',
            'chatforia_recovery_executor')
          AND pg_has_role(runtime.oid, owner_role.oid, 'MEMBER')) AS "noPrivilegedMembership",
      NOT EXISTS (SELECT FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        JOIN pg_roles runtime ON runtime.rolname = 'chatforia_dev'
        WHERE n.nspname IN ('public', 'staff_security')
          AND pg_has_role(runtime.oid, c.relowner, 'MEMBER'))
        AND NOT EXISTS (SELECT FROM pg_namespace n JOIN pg_roles runtime
          ON runtime.rolname = 'chatforia_dev'
          WHERE n.nspname IN ('public', 'staff_security')
            AND pg_has_role(runtime.oid, n.nspowner, 'MEMBER')) AS "noRuntimeOwnership",
      EXISTS (SELECT FROM pg_namespace n JOIN pg_roles r ON r.oid = n.nspowner
        WHERE n.nspname = 'staff_security' AND r.rolname = 'chatforia_staff_owner'
          AND pg_has_role(current_user, r.oid, 'SET')) AS "executorCanTransferOwnership",
      NOT EXISTS (SELECT FROM pg_extension e JOIN pg_namespace n ON n.oid = e.extnamespace
        WHERE e.extname = 'pgcrypto' AND n.nspname <> 'staff_security')
        AND EXISTS (SELECT FROM pg_available_extensions WHERE name = 'pgcrypto')
        AS "pgcryptoNamespaceCompatible"
  `;
  const failures = Object.entries(checks || {}).filter(
    ([, value]) => value !== true
  );
  if (!checks || failures.length)
    throw new PreflightError(
      `Deployment prerequisites failed: ${failures.map(([name]) => name).join(', ')}`
    );
  return checks;
}

async function assertMigrationHistory(db, env, mode, database, options) {
  const root = options.migrationRoot || 'server/prisma/migrations';
  const allNames = readdirSync(root).filter((name) => /^\d/.test(name)).sort();
  const version = options.manifestVersion ||
    (allNames.includes('20261106010000_twilio_compliance_event_sid') ? 'v2' : 'v1');
  const expected = mode === '--after-migrations'
    ? allNames
    : allNames.filter((name) => name < '20261102');
  const reconciliation = env.STAFF_MIGRATION_RECONCILIATION_ID
    ? assertReconciliationRequested(env, database, { ...options, manifestVersion: version })
    : null;
  const release = version === 'v2'
    ? reconciliation || loadReconciliationManifest({ manifestVersion: version })
    : reconciliation;
  const fullCount = version === 'v2' ? 161 : 160;
  const fullRelease = allNames.length !== 141;
  if ((mode === '--after-migrations' && allNames.length !== fullCount) ||
      (mode !== '--after-migrations' && fullRelease && allNames.length !== fullCount) ||
      (version === 'v1' && allNames.includes('20261106010000_twilio_compliance_event_sid')))
    throw new PreflightError('Migration history differs from the reviewed pre-PR baseline');
  if (version === 'v2' && fullRelease) {
    const legacy = allNames.filter((name) => name !== '20261106010000_twilio_compliance_event_sid')
      .map((name) => ({ name, sha256: createHash('sha256')
        .update(readFileSync(`${root}/${name}/migration.sql`)).digest('hex') }));
    if (legacy.length !== 160 ||
        migrationSetDigest(legacy) !== release.legacyMigrationSetSha256 ||
        allNames.filter((name) => name > '20261102094000_founder_staff_management').join(',') !==
          Object.keys(release.requiredExactMigrations).sort().join(','))
      throw new PreflightError('Migration release set differs from reviewed 161 files');
    for (const [name, checksum] of Object.entries(release.requiredExactMigrations)) {
      const actual = createHash('sha256').update(readFileSync(`${root}/${name}/migration.sql`)).digest('hex');
      if (actual !== checksum) throw new PreflightError('Required exact migration file changed');
    }
  }
  const rows = await db.$queryRaw`
    SELECT migration_name, checksum, finished_at FROM public._prisma_migrations
    WHERE rolled_back_at IS NULL ORDER BY migration_name
  `;
  if (
    expected.length !== (mode === '--after-migrations' ? fullCount : 141) ||
    rows.length !== expected.length ||
    rows.some(
      (row, index) => {
        const name = expected[index];
        const fileChecksum = createHash('sha256')
          .update(readFileSync(`${root}/${name}/migration.sql`))
          .digest('hex');
        const exception = reconciliation?.exceptions[name];
        return row.migration_name !== name || !row.finished_at ||
          (exception
            ? fileChecksum !== exception.availableChecksum || row.checksum !== exception.recordedChecksum
            : row.checksum !== fileChecksum);
      }
    )
  )
    throw new PreflightError(
      'Migration history differs from the reviewed pre-PR baseline'
    );
  if (reconciliation) await assertReconciliationCatalogAndData(db);
  return reconciliation?.id || null;
}

export async function runPreflight(db, env, mode, options = {}) {
  if (!['--before-migrations', '--after-migrations', '--runtime'].includes(mode))
    throw new PreflightError('Select --before-migrations, --after-migrations or --runtime');
  if (!env.STAFF_EXPECTED_DATABASE)
    throw new PreflightError(
      'An independently verified database name is required'
    );
  if (mode === '--runtime' && env.STAFF_SECURITY_ENABLED !== 'true')
    throw new PreflightError(
      'Post-migration runtime must enable staff security'
    );
  if (mode === '--runtime' && env.STAFF_MIGRATION_RECONCILIATION_ID)
    throw new PreflightError('Reconciliation ID is only valid for migration checks');
  return db.$transaction(
    async (tx) => {
      await tx.$executeRaw`SET TRANSACTION READ ONLY`;
      await tx.$executeRaw`SET LOCAL statement_timeout = '10s'`;
      const [identity] = await tx.$queryRaw`SELECT current_database() AS name`;
      if (identity?.name !== env.STAFF_EXPECTED_DATABASE)
        throw new PreflightError('Database identity mismatch');
      if (mode !== '--runtime') {
        const prerequisites = await assertDeploymentPrerequisites(tx);
        const reconciliationId = await assertMigrationHistory(tx, env, mode, identity.name, options);
        return { ...prerequisites, baselineMigrationHistory: true, reconciliationId };
      }
      await assertStaffRuntimeReady(tx, env);
      return { runtimeBoundaryAndKey: true };
    },
    { timeout: env.STAFF_MIGRATION_RECONCILIATION_ID ? 60000 : 15000 }
  );
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  let db;
  try {
    if (!process.env.DATABASE_URL)
      throw new PreflightError('Missing connection');
    const { PrismaClient } = await import('@prisma/client');
    db = new PrismaClient({
      log: [],
      datasources: { db: { url: process.env.DATABASE_URL } },
    });
    await runPreflight(db, process.env, process.argv[2]);
    console.log('PASS: read-only staff deployment preflight');
  } catch (error) {
    // Only our fixed catalog/configuration messages are safe to print. Driver
    // errors can contain connection information; never print their contents.
    const reason =
      error instanceof PreflightError
        ? error.message
        : 'Runtime/database check failed';
    console.error(
      `STOP: ${reason}. Keep traffic fenced; see deployment-runbook.md.`
    );
    process.exitCode = 1;
  } finally {
    await db?.$disconnect();
  }
}
