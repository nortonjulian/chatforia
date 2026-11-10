import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { parseArgs } from 'node:util';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join, resolve, isAbsolute, relative } from 'node:path';
import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  statSync,
  openSync,
  closeSync,
  fsyncSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { runRecoverySequence } from './staff-stage5-recovery-sequence.mjs';
import { loadStage5RecoveryManifest } from './staff-stage5-recovery-history.mjs';
import { readPackage, verifyPackage } from './migration-package.mjs';
import { assertPackageDatasource } from './deploy-migration-package.mjs';

// No shell, inherited stdin, or printed driver diagnostics. Detached children
// are awaited before cleanup, including after an operator SIGINT/SIGTERM.
export function runRecoveryChild(command, args, options) {
  return new Promise((accept, reject) => {
    const { timeout = 60000, ...spawnOptions } = options;
    const child = spawn(command, args, {
      ...spawnOptions,
      detached: true,
      stdio: ['ignore', 'ignore', 'ignore'],
    });
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      try {
        process.kill(-child.pid, 'SIGKILL');
      } catch {
        /* Already exited. */
      }
    }, timeout);
    child.once('error', () => {
      clearTimeout(timer);
      reject(new Error('Child failed to start'));
    });
    child.once('close', (code) => {
      clearTimeout(timer);
      if (code === 0 && !timedOut) accept();
      else
        reject(
          new Error(
            'Child failed or timed out; inspect private database diagnostics'
          )
        );
    });
  });
}

export function recoveryConnection(env, manifest) {
  const url = new URL(env.DATABASE_URL);
  const allowed = new Set([
    'sslmode',
    'sslaccept',
    'sslrootcert',
    'sslcert',
    'schema',
    'connection_limit',
  ]);
  assert.ok(['postgres:', 'postgresql:'].includes(url.protocol));
  assert.equal(url.hostname, manifest.target.hostname);
  assert.equal(Number(url.port), manifest.target.port);
  assert.equal(
    decodeURIComponent(url.pathname.slice(1)),
    manifest.target.database
  );
  assert.equal(decodeURIComponent(url.username), 'doadmin');
  assert.equal(url.hash, '');
  assert.equal(url.searchParams.get('sslmode'), 'require');
  assert.equal(url.searchParams.get('sslaccept'), 'strict');
  assert.ok(!env.DIRECT_URL && !env.SHADOW_DATABASE_URL);
  assert.equal(
    new Set(url.searchParams.keys()).size,
    [...url.searchParams.keys()].length
  );
  for (const key of url.searchParams.keys()) assert.ok(allowed.has(key));
  assert.ok(
    !url.searchParams.has('schema') ||
      url.searchParams.get('schema') === 'public'
  );
  const ca =
    url.searchParams.get('sslrootcert') || url.searchParams.get('sslcert');
  assert.ok(ca && isAbsolute(ca) && statSync(ca).isFile());
  if (url.searchParams.has('sslrootcert') && url.searchParams.has('sslcert'))
    assert.equal(
      url.searchParams.get('sslrootcert'),
      url.searchParams.get('sslcert')
    );
  const childEnv = Object.fromEntries(
    Object.entries(env).filter(([key]) => !key.startsWith('PG'))
  );
  return {
    url,
    psqlEnv: {
      ...childEnv,
      PGHOST: url.hostname,
      PGPORT: url.port,
      PGDATABASE: manifest.target.database,
      PGUSER: 'doadmin',
      PGPASSWORD: decodeURIComponent(url.password),
      PGSSLMODE: 'verify-full',
      PGSSLROOTCERT: ca,
      PGCONNECT_TIMEOUT: '15',
      PGAPPNAME: 'stage5-reviewed-recovery',
    },
  };
}

export async function runRecovery(options) {
  const root = realpathSync(
    resolve(dirname(fileURLToPath(import.meta.url)), '../..')
  );
  assert.equal(
    realpathSync(process.cwd()),
    root,
    'Run from the reviewed checkout root'
  );
  const manifest = loadStage5RecoveryManifest();
  assert.equal(process.env.STAFF_STAGE5_RECOVERY_ID, manifest.id);
  assert.equal(
    process.env.STAFF_MIGRATION_RECONCILIATION_ID,
    manifest.reconciliationId
  );
  assert.equal(
    options.execute,
    true,
    'Separate owner approval is required; supply --execute only afterward'
  );
  const deadline = Date.parse(options.deadline);
  assert.ok(
    /(Z|[+-]\d\d:\d\d)$/.test(options.deadline || '') &&
      Number.isFinite(deadline)
  );
  const budget = (minutes = 20) => {
    assert.ok(
      Date.now() + minutes * 60 * 1000 < deadline,
      'Insufficient window for bounded commands, cleanup and final checks'
    );
  };
  budget();
  const { url, psqlEnv } = recoveryConnection(process.env, manifest);
  const bundle = readPackage(options.package, manifest.packageSha256);
  const files = verifyPackage(bundle);
  assertPackageDatasource(files.get('server/prisma/schema.prisma').toString());
  const archive = realpathSync(options.archive);
  const distance = relative(root, archive);
  assert.ok(distance.startsWith('..') || isAbsolute(distance));
  assert.equal(statSync(archive).mode & 0o077, 0, 'Archive must be private');
  const lock = join(archive, 'stage5-recovery.lock');
  const lockFd = openSync(lock, 'wx', 0o600);
  closeSync(lockFd);
  // A failure retains this lock as an explicit incident marker: never auto-retry.
  const receiptDir = mkdtempSync(join(archive, 'stage5-recovery-'));
  const work = mkdtempSync(join(tmpdir(), 'stage5-recovery-'));
  let interrupted = false;
  const interrupt = () => {
    interrupted = true;
  };
  process.on('SIGINT', interrupt);
  process.on('SIGTERM', interrupt);
  const { PrismaClient } = await import('@prisma/client');
  const { stage5RecoveryPreflight } = await import(
    './staff-stage5-recovery-preflight.mjs'
  );
  const { runPreflight } = await import('./staff-deployment-preflight.mjs');
  const prisma = join(root, 'node_modules/prisma');
  assert.equal(
    JSON.parse(readFileSync(join(prisma, 'package.json'))).version,
    JSON.parse(files.get('package-lock.json')).packages['node_modules/prisma']
      .version
  );
  let before;
  let eventNumber = 0;
  function record(stage, status) {
    const path = join(
      receiptDir,
      `${String(++eventNumber).padStart(2, '0')}-${stage}-${status}.json`
    );
    writeFileSync(
      path,
      JSON.stringify({
        stage,
        status,
        at: new Date().toISOString(),
        packageSha256: manifest.packageSha256,
        target: manifest.target,
      }),
      { flag: 'wx', mode: 0o600 }
    );
    const fd = openSync(path, 'r');
    try {
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
  }
  async function gate(phase) {
    const db = new PrismaClient({
      log: [],
      datasources: { db: { url: url.toString() } },
    });
    try {
      const result = await stage5RecoveryPreflight(db, bundle, manifest, phase);
      if (phase === 'failed') before = result;
      else assert.equal(result.preserveUserCount, before.preserveUserCount);
      if (phase === 'complete')
        await runPreflight(
          db,
          { ...process.env, STAFF_EXPECTED_DATABASE: manifest.target.database },
          '--after-migrations',
          {
            migrationRoot: join(work, 'server/prisma/migrations'),
            manifestVersion: 'v2',
          }
        );
      writeFileSync(join(receiptDir, `${phase}.json`), JSON.stringify(result), {
        flag: 'wx',
        mode: 0o600,
      });
    } finally {
      await db.$disconnect();
    }
  }
  const sql = (name) =>
    runRecoveryChild(
      'psql',
      [
        '-X',
        '-w',
        '-v',
        'ON_ERROR_STOP=1',
        '-f',
        join(
          root,
          `server/scripts/staff-stage5-recovery-${name}-executor-inherit.sql`
        ),
      ],
      { env: psqlEnv, cwd: work, timeout: 90000 }
    );
  const migrate = (...args) =>
    runRecoveryChild(
      process.execPath,
      [
        join(prisma, 'build/index.js'),
        'migrate',
        ...args,
        '--schema',
        join(work, 'server/prisma/schema.prisma'),
      ],
      {
        env: {
          ...process.env,
          DATABASE_URL: url.toString(),
          PRISMA_HIDE_UPDATE_MESSAGE: 'true',
        },
        cwd: work,
        timeout: args[0] === 'deploy' ? 600000 : 60000,
      }
    );
  const tracked = (name, action) => async () => {
    record(name, 'started');
    try {
      await action();
      record(name, 'passed');
    } catch {
      record(name, 'failed');
      throw new Error(`${name} failed`);
    }
  };
  try {
    // Every SQL byte comes from the independently hashed c103 package.
    for (const [path, bytes] of files) {
      const dest = join(work, path);
      mkdirSync(dirname(dest), { recursive: true, mode: 0o700 });
      writeFileSync(dest, bytes, { flag: 'wx', mode: 0o400 });
    }
    await runRecoverySequence(
      {
        failed: tracked('failed-gate', () => gate('failed')),
        beforeEnable: async () => {
          budget();
        },
        enable: tracked('enable', () => sql('enable')),
        resolve: tracked('resolve', () =>
          migrate('resolve', '--rolled-back', manifest.failedMigration.name)
        ),
        resolved: tracked('resolved-gate', () => gate('resolved')),
        beforeDeploy: async () => {
          budget(14);
          readPackage(options.package, manifest.packageSha256);
        },
        deploy: tracked('deploy', () => migrate('deploy')),
        // Do not let a receipt write failure prevent the actual privilege cleanup.
        disable: async () => {
          await sql('disable');
          record('disable', 'passed');
        },
        complete: tracked('complete-gate', () => gate('complete')),
      },
      () => interrupted
    );
    rmSync(lock);
    console.log(
      'PASS: migration recovery checks passed; API switch is not performed by this tool'
    );
  } finally {
    process.removeListener('SIGINT', interrupt);
    process.removeListener('SIGTERM', interrupt);
    rmSync(work, { recursive: true, force: true });
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const { values } = parseArgs({
    options: {
      package: { type: 'string' },
      archive: { type: 'string' },
      deadline: { type: 'string' },
      execute: { type: 'boolean' },
    },
  });
  try {
    await runRecovery(values);
  } catch {
    console.error(
      'STOP: recovery not verified. Keep traffic fenced and inspect private receipts. Do not retry.'
    );
    process.exitCode = 1;
  }
}
