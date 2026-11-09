import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { copyFileSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { PrismaClient } from '@prisma/client';
import {
  deleteExpiredOrdinaryResetTokens,
  deleteOldUsedOrdinaryResetTokens,
} from '../cron/ordinaryResetTokenCleanup.js';
import { buildPackage, checkReconciledHistory } from './migration-package.mjs';
import { ledger } from './deploy-migration-package.mjs';
import { runPreflight } from './staff-deployment-preflight.mjs';

// Runs only inside the public repository's standard CI job, against the job's
// new postgres:18.6 service. Never accepts a caller-supplied database URL.
assert.equal(process.env.GITHUB_ACTIONS, 'true');
assert.equal(process.env.GITHUB_EVENT_NAME, 'pull_request');
assert.equal(process.env.GITHUB_REPOSITORY, 'nortonjulian/chatforia');
const container = process.env.CI_POSTGRES18_CONTAINER || '';
assert.match(container, /^[a-f0-9]{12,64}$/);
const image = execFileSync('docker', ['inspect', '--format', '{{.Config.Image}} {{.State.Running}}', container], { encoding: 'utf8' }).trim();
assert.equal(image, 'postgres:18.6 true');
const database = 'defaultdb';
const target = new URL('postgresql://chatforia@127.0.0.1:5433/defaultdb');
target.password = 'qa_password'; // disposable CI service credential only
const url = target.toString();
const sql = (query) => execFileSync('docker', [
  'exec', '-i', container, 'psql', '-X', '-A', '-t', '-q',
  '-v', 'ON_ERROR_STOP=1', '-U', 'chatforia', '-d', database,
], { input: query, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], maxBuffer: 4 * 1024 * 1024 });
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
assert.equal(sql("SELECT current_setting('server_version_num')::int / 10000, current_database(), current_user").trim(), '18|defaultdb|chatforia');

const roleSql = readFileSync('server/scripts/staff-production-prerequisite-roles.sql', 'utf8');
const recoveryLoginSql = readFileSync('server/scripts/staff-recovery-operator-logins.sql', 'utf8');
const asManagedCreator = (query) => execFileSync('docker', [
  'exec', '-i', container, 'psql', '-X', '-A', '-t', '-q',
  '-v', 'ON_ERROR_STOP=1', '-U', 'staff_managed_creator', '-d', database,
], { input: query, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], maxBuffer: 4 * 1024 * 1024 });

// DigitalOcean's doadmin has CREATEROLE but is not a superuser. PostgreSQL 18
// creates bootstrap-granted ADMIN memberships in each role it creates; the
// superuser-only fixture below cannot exercise that managed-service behavior.
sql('CREATE ROLE staff_managed_creator LOGIN NOSUPERUSER CREATEDB CREATEROLE REPLICATION BYPASSRLS');
sql('ALTER DATABASE defaultdb OWNER TO staff_managed_creator');
assert.equal(asManagedCreator(`SELECT session_user = 'staff_managed_creator'
  AND current_user = session_user AND NOT rolsuper AND rolcreaterole
  FROM pg_roles WHERE rolname = current_user`).trim(), 't');
asManagedCreator(roleSql);
assert.equal(sql(`SELECT count(*) = 4 AND bool_and(m.grantor = 10::oid
  AND m.admin_option AND NOT m.inherit_option AND NOT m.set_option)
  FROM pg_auth_members m
  JOIN pg_roles granted ON granted.oid = m.roleid
  JOIN pg_roles member ON member.oid = m.member
  WHERE granted.rolname IN ('chatforia_dev','chatforia_staff_owner',
    'chatforia_recovery_issuer','chatforia_recovery_executor')
    AND member.rolname = 'staff_managed_creator'`).trim(), 't');
sql('CREATE ROLE staff_unexpected_member NOLOGIN');
sql('GRANT chatforia_recovery_issuer TO staff_unexpected_member WITH SET FALSE, INHERIT FALSE, ADMIN FALSE');
assert.throws(() => asManagedCreator(recoveryLoginSql));
assert.equal(sql(`SELECT count(*) FROM pg_roles WHERE rolname IN
  ('chatforia_recovery_issuer_login','chatforia_recovery_executor_login')`).trim(), '0');
sql('REVOKE chatforia_recovery_issuer FROM staff_unexpected_member');
sql('DROP ROLE staff_unexpected_member');
asManagedCreator('GRANT chatforia_staff_owner TO staff_managed_creator WITH SET TRUE, INHERIT FALSE, ADMIN FALSE');
asManagedCreator(readFileSync('server/scripts/staff-access-bootstrap-role.sql', 'utf8'));
assert.throws(() => asManagedCreator(readFileSync('server/scripts/staff-access-bootstrap-role.sql', 'utf8')));
assert.equal(asManagedCreator("SELECT pg_has_role(current_user, 'chatforia_staff_owner', 'SET')").trim(), 't');
asManagedCreator(recoveryLoginSql);
assert.throws(() => asManagedCreator(recoveryLoginSql));
assert.equal(sql(`SELECT count(*) = 2 AND bool_and(rolpassword IS NULL)
  FROM pg_authid WHERE rolname IN
  ('chatforia_recovery_issuer_login','chatforia_recovery_executor_login')`).trim(), 't');
assert.equal(sql(`SELECT count(*) = 2 AND bool_and(NOT m.admin_option
  AND NOT m.inherit_option AND m.set_option)
  FROM pg_auth_members m
  JOIN pg_roles granted ON granted.oid = m.roleid
  JOIN pg_roles member ON member.oid = m.member
  WHERE (granted.rolname = 'chatforia_recovery_issuer'
    AND member.rolname = 'chatforia_recovery_issuer_login')
    OR (granted.rolname = 'chatforia_recovery_executor'
    AND member.rolname = 'chatforia_recovery_executor_login')`).trim(), 't');
sql(`DROP SCHEMA staff_security;
  DROP ROLE chatforia_recovery_issuer_login, chatforia_recovery_executor_login;
  DROP ROLE chatforia_dev, chatforia_staff_owner,
    chatforia_recovery_issuer, chatforia_recovery_executor;
  ALTER DATABASE defaultdb OWNER TO chatforia;
  DROP ROLE staff_managed_creator`);
console.log('PASS: PostgreSQL 18.6 non-superuser CREATEROLE grants and exclusive recovery logins');

sql(roleSql);
assert.throws(() => sql(roleSql));
assert.equal(sql(`SELECT count(*) = 4 AND bool_and(
  rolinherit = false AND rolsuper = false AND rolcreatedb = false AND
  rolcreaterole = false AND rolreplication = false AND rolbypassrls = false AND
  rolcanlogin = (rolname = 'chatforia_dev'))
  FROM pg_roles WHERE rolname IN
  ('chatforia_dev','chatforia_staff_owner','chatforia_recovery_issuer','chatforia_recovery_executor')`).trim(), 't');
sql('GRANT chatforia_recovery_executor TO chatforia_recovery_issuer WITH SET TRUE, INHERIT FALSE, ADMIN FALSE');
assert.throws(() => sql(recoveryLoginSql));
sql('REVOKE chatforia_recovery_executor FROM chatforia_recovery_issuer');
sql(recoveryLoginSql);
assert.throws(() => sql(recoveryLoginSql));
assert.equal(sql(`SELECT count(*) = 2 AND bool_and(rolcanlogin AND NOT
  (rolinherit OR rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls))
  FROM pg_roles WHERE rolname IN
  ('chatforia_recovery_issuer_login','chatforia_recovery_executor_login')`).trim(), 't');
assert.equal(sql(`SELECT count(*) = 2 AND bool_and(rolpassword IS NULL)
  FROM pg_authid WHERE rolname IN
  ('chatforia_recovery_issuer_login','chatforia_recovery_executor_login')`).trim(), 't');
assert.equal(sql(`SELECT pg_has_role('chatforia_recovery_issuer_login',
  'chatforia_recovery_issuer', 'SET') AND
  pg_has_role('chatforia_recovery_executor_login',
  'chatforia_recovery_executor', 'SET') AND
  NOT pg_has_role('chatforia_recovery_issuer_login',
  'chatforia_recovery_executor', 'MEMBER') AND
  NOT pg_has_role('chatforia_recovery_executor_login',
  'chatforia_recovery_issuer', 'MEMBER') AND
  NOT pg_has_role('chatforia_dev',
  'chatforia_recovery_issuer', 'MEMBER') AND
  NOT pg_has_role('chatforia_dev',
  'chatforia_recovery_executor', 'MEMBER')`).trim(), 't');
assert.equal(sql(`SET SESSION AUTHORIZATION chatforia_recovery_issuer_login;
  SET ROLE chatforia_recovery_issuer;
  SELECT session_user = 'chatforia_recovery_issuer_login' AND
    current_user = 'chatforia_recovery_issuer'`).trim(), 't');
assert.throws(() => sql(`SET SESSION AUTHORIZATION chatforia_recovery_issuer_login;
  SET ROLE chatforia_recovery_executor`));
assert.equal(sql(`SET SESSION AUTHORIZATION chatforia_recovery_executor_login;
  SET ROLE chatforia_recovery_executor;
  SELECT session_user = 'chatforia_recovery_executor_login' AND
    current_user = 'chatforia_recovery_executor'`).trim(), 't');
assert.throws(() => sql(`SET SESSION AUTHORIZATION chatforia_recovery_executor_login;
  SET ROLE chatforia_recovery_issuer`));
console.log('PASS: PostgreSQL 18.6 prepared recovery logins retain separate session identities and exclusive roles');
sql('GRANT chatforia_staff_owner TO chatforia WITH SET TRUE, INHERIT FALSE, ADMIN FALSE;');
sql(readFileSync('server/scripts/staff-access-bootstrap-role.sql', 'utf8'));

const root = mkdtempSync(join(tmpdir(), 'staff-pg18-reconstruction-'));
const prismaDir = join(root, 'baseline');
mkdirSync(join(prismaDir, 'migrations'), { recursive: true, mode: 0o700 });
copyFileSync('server/prisma/schema.prisma', join(prismaDir, 'schema.prisma'));
copyFileSync('server/prisma/migrations/migration_lock.toml', join(prismaDir, 'migrations/migration_lock.toml'));
const staffReleaseLastMigration = '20261102094000_founder_staff_management';
const names = readdirSync('server/prisma/migrations')
  .filter((name) => /^\d/.test(name) && name <= staffReleaseLastMigration && !name.startsWith('20261102'))
  .sort();
assert.equal(names.length, 141);
for (const name of names) {
  const target = join(prismaDir, 'migrations', name);
  mkdirSync(target, { mode: 0o700 });
  copyFileSync(`server/prisma/migrations/${name}/migration.sql`, join(target, 'migration.sql'));
}
execFileSync(process.execPath, [resolve('node_modules/prisma/build/index.js'), 'migrate', 'deploy', '--schema', join(prismaDir, 'schema.prisma')], {
  cwd: prismaDir,
  env: { PATH: process.env.PATH, LC_ALL: 'C', DATABASE_URL: url, PRISMA_HIDE_UPDATE_MESSAGE: 'true', CHECKPOINT_DISABLE: '1' },
  stdio: ['ignore', 'pipe', 'pipe'],
  maxBuffer: 8 * 1024 * 1024,
});

const evidence = JSON.parse(readFileSync('docs/staff-security/evidence/live-infrastructure-inspection.json', 'utf8'));
for (const entry of evidence.database.migrationLedger.mismatches) {
  assert.equal(sha(readFileSync(`server/prisma/migrations/${entry.migration}/migration.sql`)), entry.checkoutChecksum);
}
const db = new PrismaClient({ log: [], datasources: { db: { url } } });
const historicalMigrations = { migrationRoot: join(prismaDir, 'migrations') };
try {
  await runPreflight(db, { STAFF_EXPECTED_DATABASE: database }, '--before-migrations', historicalMigrations);
  const catalogSql = `BEGIN READ ONLY;
SELECT json_build_object('kind','column','table',c.relname,'name',a.attname,'type',format_type(a.atttypid,a.atttypmod),'notNull',a.attnotnull,'default',pg_get_expr(d.adbin,d.adrelid)) FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum WHERE n.nspname='public' AND c.relname IN ('MobileDataPackPurchase','Report','SmsBlockedNumber','Device','EsimReplacement') AND a.attnum>0 AND NOT a.attisdropped;
SELECT json_build_object('kind','index','table',t.relname,'name',i.relname,'definition',pg_get_indexdef(i.oid),'unique',x.indisunique,'valid',x.indisvalid) FROM pg_index x JOIN pg_class i ON i.oid=x.indexrelid JOIN pg_class t ON t.oid=x.indrelid JOIN pg_namespace n ON n.oid=t.relnamespace WHERE n.nspname='public' AND t.relname IN ('MobileDataPackPurchase','Report','SmsBlockedNumber','Device','EsimReplacement');
SELECT json_build_object('kind','constraint','table',t.relname,'name',c.conname,'definition',pg_get_constraintdef(c.oid),'validated',c.convalidated) FROM pg_constraint c JOIN pg_class t ON t.oid=c.conrelid JOIN pg_namespace n ON n.oid=t.relnamespace WHERE n.nspname='public' AND t.relname IN ('MobileDataPackPurchase','Report','SmsBlockedNumber','Device','EsimReplacement');
ROLLBACK;`;
  const actual = sql(catalogSql).split('\n').filter(Boolean).map((line) => JSON.parse(line)).sort((a,b) => {
    const left = `${a.kind}/${a.table}/${a.name}`;
    const right = `${b.kind}/${b.table}/${b.name}`;
    return left < right ? -1 : left > right ? 1 : 0;
  });
  const target = JSON.parse(readFileSync('docs/staff-security/evidence/migration-target-catalog.json', 'utf8')).objects;
  assert.equal(actual.length, target.length);
  const differences = actual.flatMap((entry, index) => JSON.stringify(entry) === JSON.stringify(target[index]) ? [] : [`${entry.kind}/${entry.table}/${entry.name}`]);
  assert.deepEqual(differences, [], `Current SQL reconstruction differs from target catalog in ${differences.length} objects`);
  console.log(`PASS: PostgreSQL 18.6 prepared roles and ${names.length} current baseline migrations; ${actual.length} catalog objects match target metadata`);

  // A target-shaped ledger mismatch must still be rejected. This changes only
  // the disposable CI service and restores it before the job exits.
  for (const entry of evidence.database.migrationLedger.mismatches) {
    await db.$executeRaw`UPDATE public._prisma_migrations SET checksum=${entry.recordedChecksum} WHERE migration_name=${entry.migration} AND rolled_back_at IS NULL`;
  }
  await assert.rejects(runPreflight(db, { STAFF_EXPECTED_DATABASE: database }, '--before-migrations', historicalMigrations), /Migration history differs/);
  console.log('PASS: strict preflight rejects all four recorded target checksum mismatches');

  // Retain three inert historical attempts on the disposable service, as
  // observed on the target. The original v1 checker still rejects such rows.
  for (let index = 0; index < 3; index++) {
    const id = `00000000-0000-0000-0000-${String(index + 101).padStart(12, '0')}`;
    await db.$executeRaw`INSERT INTO public._prisma_migrations
      (id, checksum, migration_name, started_at, rolled_back_at, applied_steps_count)
      VALUES (${id}, ${'e'.repeat(64)}, ${names[index]}, now(), now(), 0)`;
  }

  const manifest = JSON.parse(readFileSync('server/security/staffMigrationReconciliation.v1.json'));
  const consentManifest = JSON.parse(readFileSync('server/security/staffMigrationReconciliation.v2.json'));
  assert.equal(manifest.status, 'proposed-not-authorized-for-production');
  assert.equal(consentManifest.status, 'approved-for-production');
  const fullPackage = buildPackage('HEAD');
  const releasePackage = buildPackage('6a5f06d58c4414b7a0f584eeaede3118d3e9066b');
  const baselineLedger = await ledger(db);
  const historicalRollbacks = baselineLedger.filter((row) => row.rolled_back_at);
  assert.equal(historicalRollbacks.length, 3);
  assert.equal(checkReconciledHistory(releasePackage,
    baselineLedger.filter((row) => !row.rolled_back_at), manifest.target).length, 19);
  assert.throws(() => checkReconciledHistory(releasePackage,
    baselineLedger, manifest.target), /ledger shape changed/);
  assert.equal(checkReconciledHistory(fullPackage, baselineLedger, consentManifest.target).length, 20);
  const reconciledEnv = {
    STAFF_EXPECTED_DATABASE: database,
    STAFF_MIGRATION_RECONCILIATION_ID: manifest.id,
    // Identity input only. The Prisma client above remains bound to the
    // disposable localhost service; the production CLI uses one actual URL.
    DATABASE_URL: `postgresql://chatforia@${manifest.target.hostname}:${manifest.target.port}/${database}`,
  };
  const isolated = { allowProposedForIsolatedTest: true, manifestVersion: 'v1',
    migrationRoot: join(prismaDir, 'migrations') };
  await assert.rejects(runPreflight(db, reconciledEnv, '--before-migrations',
    { ...isolated, allowProposedForIsolatedTest: false }), /not approved for production/);
  assert.equal((await runPreflight(db, reconciledEnv, '--before-migrations', isolated)).reconciliationId, manifest.id);
  const consentEnv = { ...reconciledEnv, STAFF_MIGRATION_RECONCILIATION_ID: consentManifest.id };
  const isolatedConsent = { manifestVersion: 'v2',
    migrationRoot: 'server/prisma/migrations' };
  assert.equal((await runPreflight(db, consentEnv, '--before-migrations', isolatedConsent)).reconciliationId,
    consentManifest.id);
  await assert.rejects(runPreflight(db, { ...consentEnv,
    STAFF_MIGRATION_RECONCILIATION_ID: manifest.id }, '--before-migrations', isolatedConsent),
  /Unknown reconciliation ID/);
  await assert.rejects(runPreflight(db, { ...consentEnv,
    DATABASE_URL: 'postgresql://chatforia@wrong.example:25060/defaultdb' },
  '--before-migrations', isolatedConsent), /target differs/);
  await assert.rejects(runPreflight(db, { ...consentEnv,
    DATABASE_URL: `postgresql://chatforia@${consentManifest.target.hostname}:5432/defaultdb` },
  '--before-migrations', isolatedConsent), /target differs/);
  console.log('PASS: v1 remains proposed; activated v2 accepts only the four documented target pairs');

  await assert.rejects(runPreflight(db, { ...reconciledEnv, STAFF_MIGRATION_RECONCILIATION_ID: 'wrong' }, '--before-migrations', isolated), /Unknown reconciliation ID/);
  await assert.rejects(runPreflight(db, { ...reconciledEnv, DATABASE_URL: 'postgresql://chatforia@wrong.example:25060/defaultdb' }, '--before-migrations', isolated), /target differs/);
  await assert.rejects(runPreflight(db, { ...reconciledEnv, DATABASE_URL: `postgresql://chatforia@${manifest.target.hostname}:5432/defaultdb` }, '--before-migrations', isolated), /target differs/);
  await assert.rejects(runPreflight(db, { ...reconciledEnv, STAFF_EXPECTED_DATABASE: 'wrongdb' }, '--before-migrations', isolated), /identity/);
  const alteredManifest = join(root, 'altered-manifest.json');
  writeFileSync(alteredManifest, readFileSync('server/security/staffMigrationReconciliation.v1.json', 'utf8').replace('baselineCount": 141', 'baselineCount": 142'));
  await assert.rejects(runPreflight(db, reconciledEnv, '--before-migrations', { ...isolated, manifestPath: alteredManifest }), /manifest bytes changed/);

  const changedFile = join(prismaDir, 'migrations', names[0], 'migration.sql');
  const originalFile = readFileSync(changedFile);
  writeFileSync(changedFile, Buffer.concat([originalFile, Buffer.from('\n-- isolated tamper\n')]));
  await assert.rejects(runPreflight(db, reconciledEnv, '--before-migrations', isolated), /Migration history differs/);
  writeFileSync(changedFile, originalFile);
  const changedExceptionFile = join(prismaDir, 'migrations', evidence.database.migrationLedger.mismatches[0].migration, 'migration.sql');
  const originalExceptionFile = readFileSync(changedExceptionFile);
  writeFileSync(changedExceptionFile, Buffer.concat([originalExceptionFile, Buffer.from('\n-- isolated tamper\n')]));
  await assert.rejects(runPreflight(db, reconciledEnv, '--before-migrations', isolated), /Migration history differs/);
  writeFileSync(changedExceptionFile, originalExceptionFile);

  const firstException = evidence.database.migrationLedger.mismatches[0];
  await db.$executeRaw`UPDATE public._prisma_migrations SET checksum=${'0'.repeat(64)} WHERE migration_name=${firstException.migration} AND rolled_back_at IS NULL`;
  await assert.rejects(runPreflight(db, reconciledEnv, '--before-migrations', isolated), /Migration history differs/);
  await db.$executeRaw`UPDATE public._prisma_migrations SET checksum=${firstException.recordedChecksum} WHERE migration_name=${firstException.migration} AND rolled_back_at IS NULL`;

  const stableName = names.find((name) => !manifest.exceptions[name]);
  const stableChecksum = sha(readFileSync(`server/prisma/migrations/${stableName}/migration.sql`));
  const [stableActive] = await db.$queryRaw`SELECT id, finished_at FROM public._prisma_migrations
    WHERE migration_name=${stableName} AND rolled_back_at IS NULL`;
  await db.$executeRaw`UPDATE public._prisma_migrations SET checksum=${'f'.repeat(64)} WHERE id=${stableActive.id}`;
  await assert.rejects(runPreflight(db, reconciledEnv, '--before-migrations', isolated), /Migration history differs/);
  await db.$executeRaw`UPDATE public._prisma_migrations SET checksum=${stableChecksum} WHERE id=${stableActive.id}`;

  await db.$executeRaw`UPDATE public._prisma_migrations SET rolled_back_at=now() WHERE id=${stableActive.id}`;
  await assert.rejects(runPreflight(db, reconciledEnv, '--before-migrations', isolated), /Migration history differs/);
  await db.$executeRaw`UPDATE public._prisma_migrations SET rolled_back_at=NULL WHERE id=${stableActive.id}`;

  await db.$executeRaw`INSERT INTO public._prisma_migrations(id, checksum, migration_name, started_at, finished_at, applied_steps_count) VALUES ('00000000-0000-0000-0000-000000000001', ${'a'.repeat(64)}, '99999999_extra_synthetic', now(), now(), 1)`;
  await assert.rejects(runPreflight(db, reconciledEnv, '--before-migrations', isolated), /Migration history differs/);
  await db.$executeRaw`DELETE FROM public._prisma_migrations WHERE migration_name='99999999_extra_synthetic'`;

  await db.$executeRaw`UPDATE public._prisma_migrations SET finished_at=NULL WHERE id=${stableActive.id}`;
  await assert.rejects(runPreflight(db, reconciledEnv, '--before-migrations', isolated), /Migration history differs/);
  await db.$executeRaw`UPDATE public._prisma_migrations SET finished_at=${stableActive.finished_at} WHERE id=${stableActive.id}`;
  assert.equal((await runPreflight(db, reconciledEnv, '--before-migrations', isolated)).reconciliationId, manifest.id);
  console.log('PASS: wrong target/ID/manifest, changed files/ledger, missing/extra/unfinished and fifth mismatch fail closed');

  for (const name of readdirSync('server/prisma/migrations').filter((name) => name.startsWith('20261102')).sort()) {
    const destination = join(prismaDir, 'migrations', name);
    mkdirSync(destination, { mode: 0o700 });
    copyFileSync(`server/prisma/migrations/${name}/migration.sql`, join(destination, 'migration.sql'));
  }
  execFileSync(process.execPath, [resolve('node_modules/prisma/build/index.js'), 'migrate', 'deploy', '--schema', join(prismaDir, 'schema.prisma')], {
    cwd: prismaDir,
    env: { PATH: process.env.PATH, LC_ALL: 'C', DATABASE_URL: url, PRISMA_HIDE_UPDATE_MESSAGE: 'true', CHECKPOINT_DISABLE: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer: 8 * 1024 * 1024,
  });
  await assert.rejects(runPreflight(db, reconciledEnv, '--after-migrations',
    { ...isolated, allowProposedForIsolatedTest: false }), /not approved for production/);
  await assert.rejects(runPreflight(db, { STAFF_EXPECTED_DATABASE: database }, '--after-migrations'), /Migration history differs/);
  assert.equal((await runPreflight(db, reconciledEnv, '--after-migrations', isolated)).reconciliationId, manifest.id);
  assert.deepEqual(checkReconciledHistory(releasePackage,
    (await ledger(db)).filter((row) => !row.rolled_back_at), manifest.target, true), []);
  assert.deepEqual((await ledger(db)).filter((row) => row.rolled_back_at), historicalRollbacks);
  console.log('PASS: archived package verifies real PostgreSQL ledger before and after the four-pair exception');
  const staffName = readdirSync('server/prisma/migrations').find((name) => name.startsWith('20261102'));
  const staffChecksum = sha(readFileSync(`server/prisma/migrations/${staffName}/migration.sql`));
  await db.$executeRaw`UPDATE public._prisma_migrations SET checksum=${'b'.repeat(64)} WHERE migration_name=${staffName}`;
  await assert.rejects(runPreflight(db, reconciledEnv, '--after-migrations', isolated), /Migration history differs/);
  await db.$executeRaw`UPDATE public._prisma_migrations SET checksum=${staffChecksum} WHERE migration_name=${staffName}`;
  console.log('PASS: all new migrations apply on isolated PostgreSQL 18 and exact new checksums remain mandatory');

  const consentName = '20261106010000_twilio_compliance_event_sid';
  const consentDirectory = join(prismaDir, 'migrations', consentName);
  mkdirSync(consentDirectory, { mode: 0o700 });
  copyFileSync(`server/prisma/migrations/${consentName}/migration.sql`,
    join(consentDirectory, 'migration.sql'));
  execFileSync(process.execPath, [resolve('node_modules/prisma/build/index.js'), 'migrate', 'deploy',
    '--schema', join(prismaDir, 'schema.prisma')], {
    cwd: prismaDir,
    env: { PATH: process.env.PATH, LC_ALL: 'C', DATABASE_URL: url,
      PRISMA_HIDE_UPDATE_MESSAGE: 'true', CHECKPOINT_DISABLE: '1' },
    stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 8 * 1024 * 1024,
  });
  assert.equal((await runPreflight(db, consentEnv, '--after-migrations',
    { ...isolatedConsent, migrationRoot: join(prismaDir, 'migrations') })).reconciliationId,
    consentManifest.id);
  assert.deepEqual(checkReconciledHistory(fullPackage, await ledger(db), consentManifest.target, true), []);
  assert.deepEqual((await ledger(db)).filter((row) => row.rolled_back_at), historicalRollbacks);
  const consentFile = join(consentDirectory, 'migration.sql');
  const originalConsentSql = readFileSync(consentFile);
  writeFileSync(consentFile, Buffer.concat([originalConsentSql, Buffer.from('\n-- isolated tamper\n')]));
  await assert.rejects(runPreflight(db, consentEnv, '--after-migrations',
    { ...isolatedConsent, migrationRoot: join(prismaDir, 'migrations') }), /Required exact migration file changed/);
  writeFileSync(consentFile, originalConsentSql);
  const changedPackage = structuredClone(fullPackage);
  const consentEntry = changedPackage.files.find((file) =>
    file.path === `server/prisma/migrations/${consentName}/migration.sql`);
  consentEntry.content = Buffer.from('-- isolated tamper\n').toString('base64');
  consentEntry.sha256 = sha(Buffer.from('-- isolated tamper\n'));
  const verifiedLedger = await ledger(db);
  assert.throws(() => checkReconciledHistory(changedPackage, verifiedLedger,
    consentManifest.target, true), /Reconciliation release migration set changed/);
  await db.$executeRaw`UPDATE public._prisma_migrations SET checksum=${'f'.repeat(64)} WHERE migration_name=${consentName}`;
  await assert.rejects(runPreflight(db, consentEnv, '--after-migrations',
    { ...isolatedConsent, migrationRoot: join(prismaDir, 'migrations') }), /Migration history/);
  await db.$executeRaw`UPDATE public._prisma_migrations SET checksum=${sha(readFileSync(`server/prisma/migrations/${consentName}/migration.sql`))} WHERE migration_name=${consentName}`;
  console.log('PASS: exact consent migration and 161-file ledger pass on disposable PostgreSQL 18');

  // The live cleanup timers share the API's DATABASE_URL. Verify their token
  // cleanup shape under the restricted role without running provider jobs.
  const runtimePassword = randomBytes(24).toString('hex');
  sql(`ALTER ROLE chatforia_dev PASSWORD '${runtimePassword}'`);
  const runtimeTarget = new URL(url);
  runtimeTarget.username = 'chatforia_dev';
  runtimeTarget.password = runtimePassword;
  const runtime = new PrismaClient({ log: [], datasources: { db: { url: runtimeTarget.toString() } } });
  try {
    const [identity] = await runtime.$queryRaw`SELECT current_user AS name`;
    assert.equal(identity.name, 'chatforia_dev');
    await db.user.createMany({ data: [
      { id: 900001, username: 'qa_cron_ordinary', passwordHash: 'synthetic-unusable' },
      { id: 900002, username: 'qa_cron_admin', passwordHash: 'synthetic-unusable' },
      { id: 900003, username: 'qa_cron_staff', passwordHash: 'synthetic-unusable' },
      { id: 900004, username: 'qa_cron_founder', passwordHash: 'synthetic-unusable' },
    ] });
    const expired = new Date(Date.now() - 86_400_000);
    await db.passwordResetToken.createMany({ data: [
      { userId: 900001, tokenHash: 'a'.repeat(64), expiresAt: expired },
      { userId: 900002, tokenHash: 'b'.repeat(64), expiresAt: expired },
      { userId: 900001, tokenHash: 'c'.repeat(64), expiresAt: new Date(Date.now() + 86_400_000), usedAt: expired },
      { userId: 900002, tokenHash: 'd'.repeat(64), expiresAt: new Date(Date.now() + 86_400_000), usedAt: expired },
      { userId: 900003, tokenHash: 'e'.repeat(64), expiresAt: expired },
      { userId: 900003, tokenHash: 'f'.repeat(64), expiresAt: new Date(Date.now() + 86_400_000), usedAt: expired },
      { userId: 900004, tokenHash: '1'.repeat(64), expiresAt: expired },
      { userId: 900004, tokenHash: '2'.repeat(64), expiresAt: new Date(Date.now() + 86_400_000), usedAt: expired },
    ] });
    await db.user.update({ where: { id: 900002 }, data: { role: 'ADMIN' } });
    await db.staffAssignment.create({ data: { userId: 900003, profile: 'SUPPORT', active: true, grantedById: 900001 } });
    const enrolled = { emailVerifiedAt: new Date(), twoFactorEnabled: true,
      twoFactorEnrolledAt: new Date(), totpSecretEnc: 'synthetic-fixture-only' };
    await db.user.update({ where: { id: 900004 }, data: { ...enrolled, role: 'ADMIN' } });
    await db.user.create({ data: { id: 900005, username: 'qa_founder_target',
      passwordHash: 'synthetic-unusable', ...enrolled } });
    await db.founderOwnership.create({ data: { id: 1, userId: 900004, verificationRef: 'synthetic-ci-only' } });
    // Exercise the HTTP mutation route against the restricted database role.
    // The injected session represents the output of authentication middleware.
    const { default: express } = await import('express');
    const { default: request } = await import('supertest');
    const { createStaffRouter } = await import('../routes/staff.js');
    const { createStaffAuthorizationAssertion } = await import('../security/staffAuthorizationAssertion.js');
    process.env.STAFF_ACCESS_SIGNING_SECRET = randomBytes(32).toString('hex');
    await db.$executeRaw`INSERT INTO staff_security.assertion_secrets(id,key_version,verification_secret)
      VALUES (1,1,convert_to(${process.env.STAFF_ACCESS_SIGNING_SECRET},'UTF8'))`;
    process.env.STAFF_SECURITY_ENABLED = 'true';
    process.env.STAFF_DASHBOARD_ENABLED = 'true';
    process.env.STAFF_DASHBOARD_USER_IDS = '900004,900003';
    const founder = await db.user.findUniqueOrThrow({ where: { id: 900004 } });
    const auth = { tokenVersion: founder.tokenVersion, mfaVerified: true };
    const app = express();
    app.use(express.json(), createStaffRouter({ db: runtime, authenticate(req, _res, next) {
      req.user = founder;
      req.auth = auth;
      next();
    } }));
    await request(app).get('/session').expect(200);
    const targetId = 900005;
    const before = await db.user.findUniqueOrThrow({ where: { id: targetId } });
    for (const [index, [action, profile]] of [
      ['grant', 'CTO'], ['grant', 'ACCESS_ADMIN'], ['revoke', 'ACCESS_ADMIN'],
    ].entries()) {
      const response = await request(app).post(`/founder/assignments/${targetId}/${action}`)
        .send({ profile, reason: 'Synthetic founder acceptance' }).expect(200);
      assert.equal(response.body.sessionsRevoked, true);
      const assignment = await db.staffAssignment.findUniqueOrThrow({ where: { userId: targetId } });
      assert.equal(assignment.profile, profile);
      assert.equal(assignment.active, action !== 'revoke');
      const targetUser = await db.user.findUniqueOrThrow({ where: { id: targetId } });
      assert.equal(targetUser.tokenVersion, before.tokenVersion + index + 1);
      assert.equal(await db.staffAccessEvent.count({ where: { actorUserId: founder.id, subjectUserId: targetId } }), index + 1);
      assert.equal(await db.auditLog.count({ where: { actorId: founder.id, resource: 'staff_assignment', resourceId: String(targetId) } }), index + 1);
    }
    await request(app).post('/founder/assignments/900004/revoke').expect(403);
    const signed = (actorUserId, targetUserId) => createStaffAuthorizationAssertion({
      actorUserId, targetUserId, targetProfile: 'CTO', tokenVersion: 0, mfaVerified: true,
      action: 'STAFF_ACCESS_GRANT_OR_CHANGE',
    });
    assert.throws(() => signed(900003, 900003));
    for (const [actor, subject] of [[900003, targetId], [900003, founder.id]]) {
      await assert.rejects(runtime.$queryRaw`SELECT staff_security.founder_grant_or_change_staff_access(
        ${signed(actor, subject)}::text, 'Synthetic forged authority'::text)`);
    }
    assert.equal((await db.founderOwnership.findUniqueOrThrow({ where: { id: 1 } })).userId, founder.id);
    assert.equal((await deleteExpiredOrdinaryResetTokens(runtime, new Date())).count, 1);
    assert.equal((await deleteOldUsedOrdinaryResetTokens(runtime, new Date())).count, 1);
    assert.equal(await db.passwordResetToken.count({ where: { userId: 900001 } }), 0);
    for (const id of [900002, 900003, 900004]) {
      assert.equal(await db.passwordResetToken.count({ where: { userId: id } }), 2);
      await assert.rejects(runtime.passwordResetToken.deleteMany({ where: { userId: id } }));
    }
    await runtime.provisionLink.deleteMany({ where: { expiresAt: { lt: expired } } });
    await runtime.message.findMany({ where: { expiresAt: { lt: expired } }, take: 1 });
    await runtime.message.updateMany({ where: { id: -1 }, data: { deletedForAll: true } });
    await runtime.message.deleteMany({ where: { expiresAt: { lt: expired }, deletedForAll: true } });
    await runtime.status.deleteMany({ where: { expiresAt: { lt: expired } } });
    await runtime.phoneNumber.findMany({ take: 1 });
    await runtime.phoneNumber.updateMany({ where: { id: -1 }, data: { status: 'ASSIGNED' } });
    console.log('PASS: restricted runtime completes ordinary cleanup/job DB operations; admin, staff and founder tokens stay denied');
  } finally {
    await runtime.$disconnect();
  }
} finally {
  await db.$disconnect();
}
