import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, mkdirSync, mkdtempSync, readdirSync, readFileSync } from 'node:fs';
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
} finally {
  await db.$disconnect();
}
