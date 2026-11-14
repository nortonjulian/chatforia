import { pathToFileURL } from 'node:url';

import { PrismaClient } from '@prisma/client';
import { applicationReleaseSpec, checkReconciledHistory, readPackage, verifyPackage } from './migration-package.mjs';

const syntheticAllowed = () => process.env.GITHUB_ACTIONS === 'true' &&
  process.env.GITHUB_EVENT_NAME === 'pull_request' &&
  process.env.GITHUB_REPOSITORY === 'nortonjulian/chatforia' &&
  process.env.APPLICATION_RELEASE_SYNTHETIC_PG18 === 'yes';

export async function runApplicationReleasePreflight(db, bundle, phase, options = {}) {
  if (!['before', 'after', 'runtime'].includes(phase)) throw new Error('Unknown application release phase');
  const files = verifyPackage(bundle);
  const release = applicationReleaseSpec(files);
  if (!release) throw new Error('Missing pinned application release manifest');
  const url = new URL(options.databaseUrl || process.env.DATABASE_URL);
  const isolated = options.allowProposedForIsolatedTest === true && syntheticAllowed() &&
    url.hostname === '127.0.0.1' && url.pathname === '/chatforia_application_release_test';
  if (!isolated && (release.status !== 'approved-for-production' ||
      url.hostname !== release.target.hostname ||
      url.pathname !== `/${release.target.database}` ||
      Number(url.port) !== release.target.port))
    throw new Error('Application release lacks approval or target match');
  return db.$transaction(async (tx) => {
    await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');
    await tx.$executeRawUnsafe("SET LOCAL statement_timeout = '15s'");
    const [identity] = await tx.$queryRawUnsafe('SELECT current_database() AS database, current_user AS role');
    if (identity.database !== (isolated ? 'chatforia_application_release_test' : release.target.database) ||
        (phase === 'runtime' && identity.role !== 'chatforia_dev') ||
        (phase !== 'runtime' && identity.role === 'chatforia_dev'))
      throw new Error('Application release database or role mismatch');
    if (phase === 'before' && release.id === 'chatforia-mfa-disable-20261114-v4') {
      const [permissions] = await tx.$queryRawUnsafe(`SELECT
        has_schema_privilege(current_user,'staff_security','USAGE') AS usage,
        has_schema_privilege(current_user,'staff_security','CREATE') AS create,
        pg_has_role(current_user,'chatforia_staff_owner','SET') AS can_set_owner,
        pg_has_role('chatforia_dev','chatforia_staff_owner','MEMBER') AS runtime_member`);
      if (!permissions.usage || !permissions.create || !permissions.can_set_owner || permissions.runtime_member)
        throw new Error('MFA migration executor lacks protected-schema privileges; use the reviewed recovery procedure');
    }
    if (phase === 'before' && release.id === 'chatforia-esim-operation-lock-20261114-v5') {
      const [catalog] = await tx.$queryRawUnsafe(`SELECT
        to_regclass('public."EsimOperationLock"') IS NULL AS lock_table_absent`);
      if (!catalog.lock_table_absent)
        throw new Error('eSIM operation-lock table exists before its reviewed migration');
    }
    let pending = [];
    // The restricted API role has no migration-ledger grant. The separately
    // held DBA executor verifies exact history in before/after preflight;
    // runtime verifies only its own post-migration catalog capabilities.
    if (phase !== 'runtime') {
      const rows = await tx.$queryRawUnsafe(`SELECT id, migration_name, checksum, finished_at, rolled_back_at
        FROM public._prisma_migrations ORDER BY migration_name, started_at, id`);
      pending = checkReconciledHistory(bundle, rows, release.target, phase === 'after');
      if (phase === 'before' && pending.length !== Object.keys(release.requiredExactMigrations).length)
        throw new Error('Application release pending migration set changed');
    }
    if (phase !== 'before') {
      const [grants] = await tx.$queryRawUnsafe(`SELECT
        has_table_privilege('chatforia_dev','public."VoicemailEmailDelivery"','SELECT') AS outbox_select,
        has_table_privilege('chatforia_dev','public."VoicemailEmailDelivery"','INSERT') AS outbox_insert,
        has_table_privilege('chatforia_dev','public."VoicemailEmailDelivery"','UPDATE') AS outbox_update,
        NOT has_table_privilege('chatforia_dev','public."VoicemailEmailDelivery"','DELETE') AS outbox_no_delete,
        has_column_privilege('chatforia_dev','public."Voicemail"','forwardedToEmailAt','UPDATE') AS voicemail_mark_sent,
        has_column_privilege('chatforia_dev','public."User"','forwardQuietHoursTimeZone','UPDATE') AS zone_update,
        has_column_privilege('chatforia_dev','public."SmsMessage"','readAt','UPDATE') AS sms_read_update,
        NOT has_table_privilege('chatforia_dev','public."StaffAssignment"','UPDATE') AS no_staff_write`);
      if (Object.values(grants).some((allowed) => allowed !== true))
        throw new Error('Application release restricted runtime grants differ');
    }
    if ((phase !== 'before' && release.id === 'chatforia-mfa-disable-20261114-v4') ||
        release.id === 'chatforia-esim-operation-lock-20261114-v5') {
      const [mfa] = await tx.$queryRawUnsafe(`SELECT
        has_function_privilege('chatforia_dev','staff_security.disable_mfa(text,text)','EXECUTE') AS can_disable,
        has_function_privilege('chatforia_dev','staff_security.enroll_mfa(text,text)','EXECUTE') AS can_enroll,
        NOT has_table_privilege('chatforia_dev','staff_security.mfa_enrollment_event','INSERT') AS no_enrollment_audit_insert,
        NOT has_table_privilege('chatforia_dev','staff_security.mfa_enrollment_event','UPDATE') AS no_enrollment_audit_update,
        NOT has_table_privilege('chatforia_dev','staff_security.mfa_enrollment_event','DELETE') AS no_enrollment_audit_delete,
        NOT has_table_privilege('chatforia_dev','staff_security.mfa_disable_event','INSERT') AS no_audit_insert,
        NOT has_table_privilege('chatforia_dev','staff_security.mfa_disable_event','UPDATE') AS no_audit_update,
        NOT has_table_privilege('chatforia_dev','staff_security.mfa_disable_event','DELETE') AS no_audit_delete`);
      if (Object.values(mfa).some((allowed) => allowed !== true))
        throw new Error('MFA release restricted runtime grants differ');
    }
    if (phase !== 'before' && release.id === 'chatforia-esim-operation-lock-20261114-v5') {
      const [lock] = await tx.$queryRawUnsafe(`SELECT
        has_table_privilege('chatforia_dev','public."EsimOperationLock"','SELECT') AS can_select,
        has_table_privilege('chatforia_dev','public."EsimOperationLock"','INSERT') AS can_insert,
        has_table_privilege('chatforia_dev','public."EsimOperationLock"','DELETE') AS can_delete,
        NOT has_table_privilege('chatforia_dev','public."EsimOperationLock"','UPDATE') AS no_update`);
      if (Object.values(lock).some((allowed) => allowed !== true))
        throw new Error('eSIM operation-lock restricted runtime grants differ');
    }
    return { phase, pending, migrationCount: phase === 'before' ? release.beforeCount : release.afterCount };
  }, { timeout: 30000 });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [, , phase, packagePath, sha256] = process.argv;
  if (!phase || !packagePath || !sha256 || process.argv.length !== 5)
    throw new Error('Usage: application-release-preflight.mjs PHASE PACKAGE SHA256');
  const db = new PrismaClient();
  try {
    const result = await runApplicationReleasePreflight(db, readPackage(packagePath, sha256), phase);
    console.log(`Application release ${result.phase} preflight passed for ${result.migrationCount} migrations`);
  } finally {
    await db.$disconnect();
  }
}
