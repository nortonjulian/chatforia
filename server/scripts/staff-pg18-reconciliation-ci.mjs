import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { PrismaClient } from '@prisma/client';
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
sql(roleSql);
assert.throws(() => sql(roleSql));
assert.equal(sql(`SELECT count(*) = 4 AND bool_and(
  rolinherit = false AND rolsuper = false AND rolcreatedb = false AND
  rolcreaterole = false AND rolreplication = false AND rolbypassrls = false AND
  rolcanlogin = (rolname = 'chatforia_dev'))
  FROM pg_roles WHERE rolname IN
  ('chatforia_dev','chatforia_staff_owner','chatforia_recovery_issuer','chatforia_recovery_executor')`).trim(), 't');
sql('GRANT chatforia_staff_owner TO chatforia WITH SET TRUE, INHERIT FALSE, ADMIN FALSE;');
sql(readFileSync('server/scripts/staff-access-bootstrap-role.sql', 'utf8'));

const root = mkdtempSync(join(tmpdir(), 'staff-pg18-reconstruction-'));
const prismaDir = join(root, 'baseline');
mkdirSync(join(prismaDir, 'migrations'), { recursive: true, mode: 0o700 });
copyFileSync('server/prisma/schema.prisma', join(prismaDir, 'schema.prisma'));
copyFileSync('server/prisma/migrations/migration_lock.toml', join(prismaDir, 'migrations/migration_lock.toml'));
const names = readdirSync('server/prisma/migrations').filter((name) => /^\d/.test(name) && !name.startsWith('20261102')).sort();
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
try {
  await runPreflight(db, { STAFF_EXPECTED_DATABASE: database }, '--before-migrations');
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
  await assert.rejects(runPreflight(db, { STAFF_EXPECTED_DATABASE: database }, '--before-migrations'), /Migration history differs/);
  console.log('PASS: strict preflight rejects all four recorded target checksum mismatches');

  const manifest = JSON.parse(readFileSync('server/security/staffMigrationReconciliation.v1.json'));
  const reconciledEnv = {
    STAFF_EXPECTED_DATABASE: database,
    STAFF_MIGRATION_RECONCILIATION_ID: manifest.id,
    // Identity input only. The Prisma client above remains bound to the
    // disposable localhost service; the production CLI uses one actual URL.
    DATABASE_URL: `postgresql://chatforia@${manifest.target.hostname}:${manifest.target.port}/${database}`,
  };
  const isolated = { allowProposedForIsolatedTest: true, migrationRoot: join(prismaDir, 'migrations') };
  await assert.rejects(runPreflight(db, reconciledEnv, '--before-migrations'), /not approved for production/);
  assert.equal((await runPreflight(db, reconciledEnv, '--before-migrations', isolated)).reconciliationId, manifest.id);
  console.log('PASS: proposed exception is CI-only and accepts exactly the four documented target pairs');

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
  await db.$executeRaw`UPDATE public._prisma_migrations SET checksum=${'f'.repeat(64)} WHERE migration_name=${stableName} AND rolled_back_at IS NULL`;
  await assert.rejects(runPreflight(db, reconciledEnv, '--before-migrations', isolated), /Migration history differs/);
  await db.$executeRaw`UPDATE public._prisma_migrations SET checksum=${stableChecksum} WHERE migration_name=${stableName} AND rolled_back_at IS NULL`;

  await db.$executeRaw`UPDATE public._prisma_migrations SET rolled_back_at=now() WHERE migration_name=${stableName} AND rolled_back_at IS NULL`;
  await assert.rejects(runPreflight(db, reconciledEnv, '--before-migrations', isolated), /Migration history differs/);
  await db.$executeRaw`UPDATE public._prisma_migrations SET rolled_back_at=NULL WHERE migration_name=${stableName} AND rolled_back_at IS NOT NULL`;

  await db.$executeRaw`INSERT INTO public._prisma_migrations(id, checksum, migration_name, started_at, finished_at, applied_steps_count) VALUES ('00000000-0000-0000-0000-000000000001', ${'a'.repeat(64)}, '99999999_extra_synthetic', now(), now(), 1)`;
  await assert.rejects(runPreflight(db, reconciledEnv, '--before-migrations', isolated), /Migration history differs/);
  await db.$executeRaw`DELETE FROM public._prisma_migrations WHERE migration_name='99999999_extra_synthetic'`;

  const [finished] = await db.$queryRaw`SELECT finished_at FROM public._prisma_migrations WHERE migration_name=${stableName}`;
  await db.$executeRaw`UPDATE public._prisma_migrations SET finished_at=NULL WHERE migration_name=${stableName}`;
  await assert.rejects(runPreflight(db, reconciledEnv, '--before-migrations', isolated), /Migration history differs/);
  await db.$executeRaw`UPDATE public._prisma_migrations SET finished_at=${finished.finished_at} WHERE migration_name=${stableName}`;
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
  await assert.rejects(runPreflight(db, reconciledEnv, '--after-migrations'), /not approved for production/);
  await assert.rejects(runPreflight(db, { STAFF_EXPECTED_DATABASE: database }, '--after-migrations'), /Migration history differs/);
  assert.equal((await runPreflight(db, reconciledEnv, '--after-migrations', isolated)).reconciliationId, manifest.id);
  const staffName = readdirSync('server/prisma/migrations').find((name) => name.startsWith('20261102'));
  const staffChecksum = sha(readFileSync(`server/prisma/migrations/${staffName}/migration.sql`));
  await db.$executeRaw`UPDATE public._prisma_migrations SET checksum=${'b'.repeat(64)} WHERE migration_name=${staffName}`;
  await assert.rejects(runPreflight(db, reconciledEnv, '--after-migrations', isolated), /Migration history differs/);
  await db.$executeRaw`UPDATE public._prisma_migrations SET checksum=${staffChecksum} WHERE migration_name=${staffName}`;
  console.log('PASS: all new migrations apply on isolated PostgreSQL 18 and exact new checksums remain mandatory');
} finally {
  await db.$disconnect();
}
