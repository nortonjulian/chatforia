import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { chmodSync, copyFileSync, existsSync, fsyncSync, closeSync, openSync,
  mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve, relative, isAbsolute } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

import { checkHistory, checkReconciledHistory, reconciliationPaths, checksForPending, digest, readPackage, verifyPackage } from './migration-package.mjs';

function persist(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
  const fd = openSync(path, 'r');
  try { fsyncSync(fd); } finally { closeSync(fd); }
}

export async function ledger(db) {
  return db.$queryRawUnsafe('SELECT migration_name, checksum, finished_at, rolled_back_at FROM public._prisma_migrations ORDER BY migration_name, started_at');
}

export async function aggregateChecks(db, checks) {
  return db.$transaction(async (tx) => {
    await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');
    await tx.$executeRawUnsafe("SET LOCAL statement_timeout = '30s'");
    const result = {};
    for (const [id, check] of checks) {
      // Only reviewed aggregate SQL from the pinned package is accepted.
      // READ ONLY enforces a database write boundary for these queries.
      const rows = await tx.$queryRawUnsafe(check.sql);
      const encoded = JSON.stringify(rows);
      if (encoded.length > 16384) throw new Error('Aggregate evidence too large');
      result[id] = rows;
    }
    return result;
  }, { timeout: 120000, isolationLevel: 'RepeatableRead' });
}

export function assertChecks(checks, before, after) {
  for (const [id, check] of checks) {
    if (check.rule === 'expected') {
      assert.deepEqual(before[id], check.before, `Before predicate failed: ${id}`);
      if (after) assert.deepEqual(after[id], check.after, `After predicate failed: ${id}`);
    } else if (after) {
      assert.deepEqual(after[id], before[id], `Preservation predicate failed: ${id}`);
    }
  }
}

export async function deployPackage(options) {
  const bundle = readPackage(options.package, options.sha256);
  const files = verifyPackage(bundle);
  let url;
  try { url = new URL(process.env.DATABASE_URL); } catch { throw new Error('Invalid DATABASE_URL'); }
  if (new Set(url.searchParams.keys()).size !== [...url.searchParams.keys()].length) {
    throw new Error('Duplicate connection parameters are not allowed');
  }
  const schema = files.get('server/prisma/schema.prisma').toString();
  const datasource = schema.match(/datasource\s+db\s*\{([^}]+)\}/)?.[1].replace(/\s/g, '');
  if (datasource !== 'provider="postgresql"url=env("DATABASE_URL")' ||
      (schema.match(/datasource\s+/g) || []).length !== 1) {
    throw new Error('Package datasource requires separate review');
  }
  if (url.hostname !== options.host || decodeURIComponent(url.pathname.slice(1)) !== options.database ||
      !['postgres:', 'postgresql:'].includes(url.protocol)) throw new Error('Database target mismatch');
  if (url.searchParams.has('schema') && url.searchParams.get('schema') !== 'public') {
    throw new Error('Only the reviewed public migration ledger is supported');
  }
  if (url.searchParams.get('sslmode') !== 'require' || url.searchParams.get('sslaccept') !== 'strict' ||
      url.searchParams.has('host')) throw new Error('Certificate and hostname verification required');
  for (const name of ['sslcert', 'sslrootcert']) {
    const certificate = url.searchParams.get(name);
    if (certificate && !isAbsolute(certificate)) throw new Error('Use an absolute CA certificate path');
  }
  if (process.env.DIRECT_URL || process.env.SHADOW_DATABASE_URL) {
    throw new Error('Alternate URLs require a separately reviewed deployment path');
  }
  let reconciliation = null;
  if (process.env.STAFF_MIGRATION_RECONCILIATION_ID) {
    const { assertReconciliationRequested } = await import('../security/staffMigrationReconciliation.js');
    // No isolated-test bypass here. Risk acceptance alone cannot open this gate.
    reconciliation = assertReconciliationRequested(process.env, options.database);
    for (const path of reconciliationPaths) {
      if (!files.has(path) || digest(files.get(path)) !== digest(readFileSync(path))) {
        throw new Error('Archived reconciliation evidence differs from reviewed checkout');
      }
    }
  }
  const historyCheck = (rows, complete = false) => reconciliation
    ? checkReconciledHistory(bundle, rows, { hostname: url.hostname,
      database: options.database, port: url.port }, complete)
    : checkHistory(bundle, rows, complete);
  const archive = realpathSync(options.archive);
  const checkout = realpathSync(resolve(dirname(fileURLToPath(import.meta.url)), '../..'));
  const archiveRelative = relative(checkout, archive);
  if (!archiveRelative || (!archiveRelative.startsWith('..') && !isAbsolute(archiveRelative))) {
    throw new Error('Archive must be outside the deployment checkout');
  }
  // The operator supplies durable private storage, independent of the API host.
  const receiptDirectory = join(archive, `${bundle.commit}-${randomUUID()}`);
  mkdirSync(receiptDirectory, { mode: 0o700 });
  const receipt = { version: 1, commit: bundle.commit, packageSha256: options.sha256,
    target: { host: options.host, database: options.database, port: Number(url.port || 5432) },
    reconciliation: reconciliation ? { id: reconciliation.id,
      manifestSha256: digest(files.get(reconciliationPaths[0])), exceptions: reconciliation.exceptions } : null,
    startedAt: new Date().toISOString() };
  persist(join(receiptDirectory, 'started.json'), receipt);
  const archivedPackage = join(receiptDirectory, 'package.json');
  copyFileSync(options.package, archivedPackage);
  chmodSync(archivedPackage, 0o600);
  assert.equal(digest(readFileSync(archivedPackage)), options.sha256);
  const packageFd = openSync(archivedPackage, 'r');
  try { fsyncSync(packageFd); } finally { closeSync(packageFd); }
  const work = mkdtempSync(join(tmpdir(), 'chatforia-migration-'));
  let db;
  try {
    for (const [path, bytes] of files) {
      const destination = join(work, path);
      mkdirSync(dirname(destination), { recursive: true, mode: 0o700 });
      writeFileSync(destination, bytes, { flag: 'wx', mode: 0o400 });
    }
    const lock = JSON.parse(files.get('package-lock.json'));
    const prismaDirectory = resolve(checkout, 'node_modules/prisma');
    const installedVersion = JSON.parse(readFileSync(join(prismaDirectory, 'package.json'))).version;
    assert.equal(installedVersion, lock.packages['node_modules/prisma'].version, 'Prisma CLI differs from release lockfile');
    const { PrismaClient } = await import('@prisma/client');
    db = new PrismaClient({ log: [], datasources: { db: { url: process.env.DATABASE_URL } } });
    // Hold a separate transaction lock across preflight, Prisma deployment and receipt.
    await db.$transaction(async (guard) => {
      const [locked] = await guard.$queryRawUnsafe('SELECT pg_try_advisory_xact_lock(73421, 300) AS acquired');
      if (!locked.acquired) throw new Error('Another packaged migration deployment is active');
      const [identity] = await db.$queryRawUnsafe('SELECT current_database() AS name');
      assert.equal(identity.name, options.database, 'Connected database differs from approved target');
      receipt.beforeHistory = await ledger(db);
      const pending = historyCheck(receipt.beforeHistory);
      receipt.pending = pending;
      const checks = checksForPending(files, pending);
      receipt.beforeChecks = await aggregateChecks(db, checks);
      assertChecks(checks, receipt.beforeChecks);
      persist(join(receiptDirectory, 'before.json'), receipt);
      if (reconciliation) {
        const { runPreflight } = await import('./staff-deployment-preflight.mjs');
        await runPreflight(db, { ...process.env, STAFF_EXPECTED_DATABASE: options.database }, '--before-migrations',
          { migrationRoot: join(work, 'server/prisma/migrations') });
      }
      if (!options.execute) {
        receipt.status = 'preflight-only';
        return;
      }
      // Require the existing staff prerequisites in addition to the generic ledger check.
      if (!reconciliation && pending.some((name) => name.startsWith('20261102'))) {
        const { runPreflight } = await import('./staff-deployment-preflight.mjs');
        await runPreflight(db, { ...process.env, STAFF_EXPECTED_DATABASE: options.database }, '--before-migrations',
          { migrationRoot: join(work, 'server/prisma/migrations') });
      }
      const result = spawnSync(process.execPath, [join(prismaDirectory, 'build/index.js'),
        'migrate', 'deploy', '--schema', join(work, 'server/prisma/schema.prisma')],
      { cwd: work, env: { ...process.env, PRISMA_HIDE_UPDATE_MESSAGE: 'true' },
        encoding: 'utf8', timeout: 900000, maxBuffer: 8 * 1024 * 1024 });
      // Driver logs may contain secrets. Receipts retain the result and ledger only.
      receipt.migrationExitCode = result.status;
      receipt.afterHistory = await ledger(db);
      if (result.error || result.status !== 0) throw new Error('Migration command failed; inspect private server diagnostics');
      historyCheck(receipt.afterHistory, true);
      if (reconciliation) {
        const { runPreflight } = await import('./staff-deployment-preflight.mjs');
        await runPreflight(db, { ...process.env, STAFF_EXPECTED_DATABASE: options.database }, '--after-migrations',
          { migrationRoot: join(work, 'server/prisma/migrations') });
      }
      receipt.afterChecks = await aggregateChecks(db, checks);
      assertChecks(checks, receipt.beforeChecks, receipt.afterChecks);
      receipt.status = 'verified';
    }, { timeout: 1200000, maxWait: 10000 });
  } catch {
    receipt.status = 'failed';
    // Preserve a partial or failed migration ledger when the database remains reachable.
    if (db) {
      try { receipt.afterHistory = await ledger(db); } catch { receipt.ledgerReadFailed = true; }
    }
    throw new Error(`Deployment stopped. Private evidence: ${receiptDirectory}`);
  } finally {
    receipt.completedAt = new Date().toISOString();
    persist(join(receiptDirectory, 'receipt.json'), receipt);
    if (db) await db.$disconnect();
    rmSync(work, { recursive: true, force: true });
  }
  console.log(`Migration status ${receipt.status}. Private receipt: ${receiptDirectory}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { values } = parseArgs({ options: { package: { type: 'string' }, sha256: { type: 'string' },
    host: { type: 'string' }, database: { type: 'string' }, archive: { type: 'string' }, execute: { type: 'boolean' } } });
  for (const name of ['package', 'sha256', 'host', 'database', 'archive']) {
    if (!values[name]) throw new Error(`Missing --${name}`);
  }
  if (!existsSync(values.archive)) throw new Error('Provision private independent archive storage first');
  await deployPackage(values);
}
