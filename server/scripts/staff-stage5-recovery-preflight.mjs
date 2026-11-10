import { parseArgs } from 'node:util';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
import { readFileSync, realpathSync, statSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { PrismaClient } from '@prisma/client';
import { readPackage } from './migration-package.mjs';
import { ledger } from './deploy-migration-package.mjs';
import { assertDeploymentPrerequisites } from './staff-deployment-preflight.mjs';
import { assertReconciliationCatalogAndData } from '../security/staffMigrationReconciliation.js';
import {
  checkStage5RecoveryHistory,
  loadStage5RecoveryManifest,
} from './staff-stage5-recovery-history.mjs';

// Read-only incident gate. It never resolves a migration, changes permissions,
// or invokes Prisma migrate. Production execution requires separate approval.
export async function stage5RecoveryPreflight(
  db,
  bundle,
  manifest,
  phase,
  { executorRole = 'doadmin' } = {}
) {
  return db.$transaction(
    async (tx) => {
      await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');
      await tx.$executeRawUnsafe("SET LOCAL statement_timeout = '30s'");
      const [identity] =
        await tx.$queryRawUnsafe(`SELECT current_database() AS database,
      current_user AS role, session_user AS session_role,
      current_setting('server_version_num')::integer / 10000 AS major`);
      if (
        identity.database !== manifest.target.database ||
        identity.role !== executorRole ||
        identity.session_role !== executorRole ||
        identity.major !== 18
      )
        throw new Error(
          'Recovery database, executor or PostgreSQL version differs'
        );
      await assertDeploymentPrerequisites(tx);
      const pending = checkStage5RecoveryHistory(
        bundle,
        await ledger(tx),
        manifest.target,
        manifest,
        phase
      );
      await assertReconciliationCatalogAndData(tx);
      const [catalog] = await tx.$queryRawUnsafe(`SELECT
      (SELECT count(*)::int FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
        WHERE n.nspname='staff_security' AND c.relkind IN ('r','p','v','m','S')) AS objects,
      (SELECT count(*)::int FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
        WHERE n.nspname='staff_security') AS functions,
      (SELECT count(*)::int FROM public."StaffAssignment") AS assignments,
      (SELECT count(*)::int FROM public."StaffAccessEvent") AS events,
      (SELECT count(*)::int FROM public."FounderOwnership") AS founders,
      has_schema_privilege(current_user,'staff_security','USAGE') AS executor_usage,
      has_schema_privilege(current_user,'staff_security','CREATE') AS executor_create,
      has_schema_privilege('chatforia_dev','staff_security','CREATE') AS runtime_create,
      pg_has_role('chatforia_dev','chatforia_staff_owner','MEMBER') AS runtime_owner_member,
      has_table_privilege('chatforia_dev','public."StaffAssignment"','UPDATE') AS runtime_assignment_update,
      has_table_privilege('chatforia_dev','public."StaffAccessEvent"','INSERT') AS runtime_event_insert,
      has_column_privilege('chatforia_dev','public."User"','role','UPDATE') AS runtime_role_update,
      EXISTS (SELECT FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
        JOIN pg_roles r ON r.oid=c.relowner WHERE n.nspname='staff_security'
        AND c.relkind IN ('r','p') AND r.rolname <> 'chatforia_staff_owner') AS wrong_table_owner`);
      if (
        catalog.runtime_create ||
        catalog.runtime_owner_member ||
        (phase !== 'complete' &&
          (catalog.objects ||
            catalog.functions ||
            catalog.assignments ||
            catalog.events ||
            catalog.founders)) ||
        (phase === 'failed' &&
          (catalog.executor_usage || catalog.executor_create)) ||
        (phase === 'resolved' &&
          (!catalog.executor_usage || !catalog.executor_create)) ||
        (phase === 'complete' &&
          (catalog.executor_usage ||
            catalog.executor_create ||
            catalog.runtime_assignment_update ||
            catalog.runtime_event_insert ||
            catalog.runtime_role_update ||
            catalog.wrong_table_owner ||
            catalog.objects < 3))
      ) {
        throw new Error(
          'Recovery catalog or temporary privilege state differs'
        );
      }
      const [users] = await tx.$queryRawUnsafe(
        'SELECT count(*)::text AS total FROM public."User"'
      );
      return {
        phase,
        pending: pending.length,
        ledger:
          phase === 'complete'
            ? '161/4/0'
            : phase === 'resolved'
              ? '143/4/0'
              : '143/3/1',
        catalog: 'verified',
        preserveUserCount: users.total,
      };
    },
    { isolationLevel: 'RepeatableRead', timeout: 120000 }
  );
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const { values } = parseArgs({
    options: {
      package: { type: 'string' },
      phase: { type: 'string' },
      'receipt-dir': { type: 'string' },
      'before-receipt': { type: 'string' },
    },
  });
  const manifest = loadStage5RecoveryManifest();
  if (
    !values.package ||
    !values['receipt-dir'] ||
    !['failed', 'resolved', 'complete'].includes(values.phase) ||
    (values.phase !== 'failed' && !values['before-receipt'])
  )
    throw new Error(
      'Supply --package, --phase, private --receipt-dir and prior --before-receipt when needed'
    );
  if (
    process.env.STAFF_STAGE5_RECOVERY_ID !== manifest.id ||
    process.env.STAFF_MIGRATION_RECONCILIATION_ID !== manifest.reconciliationId
  )
    throw new Error('Explicit recovery and reconciliation IDs are required');
  const bundle = readPackage(values.package, manifest.packageSha256);
  let url;
  try {
    url = new URL(process.env.DATABASE_URL);
  } catch {
    throw new Error('Invalid database URL');
  }
  if (
    !['postgres:', 'postgresql:'].includes(url.protocol) ||
    url.hostname !== manifest.target.hostname ||
    decodeURIComponent(url.pathname.slice(1)) !== manifest.target.database ||
    Number(url.port) !== manifest.target.port ||
    url.searchParams.get('sslmode') !== 'require' ||
    url.searchParams.get('sslaccept') !== 'strict' ||
    (url.searchParams.has('schema') &&
      url.searchParams.get('schema') !== 'public') ||
    url.searchParams.has('host') ||
    new Set(url.searchParams.keys()).size !==
      [...url.searchParams.keys()].length ||
    process.env.DIRECT_URL ||
    process.env.SHADOW_DATABASE_URL
  ) {
    throw new Error('Recovery target or TLS identity differs');
  }
  for (const name of ['sslcert', 'sslrootcert']) {
    const path = url.searchParams.get(name);
    if (path && !isAbsolute(path))
      throw new Error('Certificate path must be absolute');
  }
  const db = new PrismaClient({
    log: [],
    datasources: { db: { url: url.toString() } },
  });
  try {
    const result = await stage5RecoveryPreflight(
      db,
      bundle,
      manifest,
      values.phase
    );
    if (values['before-receipt']) {
      const before = JSON.parse(readFileSync(values['before-receipt']));
      if (
        before.phase !== 'failed' ||
        before.manifestId !== manifest.id ||
        before.packageSha256 !== manifest.packageSha256 ||
        before.ledger !== '143/3/1' ||
        before.pending !== 18 ||
        JSON.stringify(before.target) !== JSON.stringify(manifest.target) ||
        (statSync(values['before-receipt']).mode & 0o077) !== 0 ||
        before.preserveUserCount !== result.preserveUserCount
      ) {
        throw new Error(
          'Recovery before/after user count or pinned receipt differs'
        );
      }
    }
    const archive = realpathSync(values['receipt-dir']);
    const checkout = realpathSync(
      resolve(dirname(fileURLToPath(import.meta.url)), '../..')
    );
    const distance = relative(checkout, archive);
    if (
      !distance ||
      (!distance.startsWith('..') && !isAbsolute(distance)) ||
      (statSync(archive).mode & 0o077) !== 0
    ) {
      throw new Error(
        'Use an owner-only receipt directory outside the checkout'
      );
    }
    const receipt = {
      version: 1,
      phase: result.phase,
      manifestId: manifest.id,
      packageSha256: manifest.packageSha256,
      target: manifest.target,
      ledger: result.ledger,
      pending: result.pending,
      preserveUserCount: result.preserveUserCount,
      completedAt: new Date().toISOString(),
    };
    const output = join(
      archive,
      `stage5-recovery-${result.phase}-${randomUUID()}.json`
    );
    writeFileSync(output, `${JSON.stringify(receipt, null, 2)}\n`, {
      flag: 'wx',
      mode: 0o600,
    });
    console.log(
      `PASS: read-only Stage 5 recovery ${result.phase}: ${result.ledger}, ${result.pending} pending. Private receipt: ${output}`
    );
  } finally {
    await db.$disconnect();
  }
}
