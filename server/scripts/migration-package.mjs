import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
const migrationPath = /^server\/prisma\/migrations\/([A-Za-z0-9_-]+)\/migration\.sql$/;
export const reconciliationPaths = [
  'server/security/staffMigrationReconciliation.v1.json',
  'docs/staff-security/evidence/live-infrastructure-inspection.json',
  'docs/staff-security/evidence/migration-target-catalog.json',
  'docs/staff-security/evidence/migration-current-data-invariants.json',
];
const reconciliationDigest = 'a59c5f947c0d2059c98f67e85230b74d6ceccfbc9d778e44278680983e2630e5';
const allowedPath = (path) => migrationPath.test(path) || [
  'server/prisma/schema.prisma', 'server/prisma/migrations/migration_lock.toml',
  'server/prisma/deployment-checks.json', 'package-lock.json',
...reconciliationPaths,
].includes(path);

export function buildPackage(ref, cwd = process.cwd()) {
  const git = (...args) => execFileSync('git', args, { cwd, maxBuffer: 32 * 1024 * 1024 });
  const commit = git('rev-parse', '--verify', `${ref}^{commit}`).toString().trim();
  const files = git('ls-tree', '-rz', commit, '--', 'server/prisma', 'package-lock.json', ...reconciliationPaths)
    .toString().split('\0').filter(Boolean)
    .filter((entry) => allowedPath(entry.split('\t')[1])).map((entry) => {
      const [metadata, path] = entry.split('\t');
      const [mode, type, object] = metadata.split(' ');
      if (!allowedPath(path) || mode !== '100644' || type !== 'blob') {
        throw new Error(`Unreviewed release file: ${path}`);
      }
      const bytes = git('cat-file', 'blob', object);
      return { path, sha256: digest(bytes), content: bytes.toString('base64') };
    }).sort((a, b) => a.path.localeCompare(b.path));
  const bundle = { version: 1, commit, files };
  verifyPackage(bundle);
  return bundle;
}

export function verifyPackage(bundle) {
  if (bundle.version !== 1 || !/^[a-f0-9]{40}$/.test(bundle.commit) || !Array.isArray(bundle.files)) {
    throw new Error('Invalid release package');
  }
  const files = new Map();
  for (const file of bundle.files) {
    if (!allowedPath(file.path) || files.has(file.path) || typeof file.content !== 'string') {
      throw new Error('Invalid or duplicate release path');
    }
    const bytes = Buffer.from(file.content, 'base64');
    if (bytes.toString('base64') !== file.content || digest(bytes) !== file.sha256) {
      throw new Error(`Release checksum mismatch: ${file.path}`);
    }
    files.set(file.path, bytes);
  }
  for (const path of ['server/prisma/schema.prisma', 'server/prisma/migrations/migration_lock.toml',
    'server/prisma/deployment-checks.json', 'package-lock.json']) {
    if (!files.has(path)) throw new Error(`Missing release file: ${path}`);
  }
  return files;
}

export function readPackage(path, expectedDigest) {
  const bytes = readFileSync(path);
  if (!/^[a-f0-9]{64}$/.test(expectedDigest) || digest(bytes) !== expectedDigest) {
    throw new Error('Package differs from independently reviewed SHA-256');
  }
  const bundle = JSON.parse(bytes);
  verifyPackage(bundle);
  return bundle;
}

export function checkHistory(bundle, rows, complete = false) {
  const migrations = new Map(bundle.files.filter((file) => migrationPath.test(file.path))
    .map((file) => [file.path.match(migrationPath)[1], file.sha256]));
  const applied = new Set();
  for (const row of rows) {
    if (row.rolled_back_at) continue;
    if (!row.finished_at || applied.has(row.migration_name) ||
      migrations.get(row.migration_name) !== row.checksum) {
      throw new Error(`Database migration history mismatch: ${row.migration_name}`);
    }
    applied.add(row.migration_name);
  }
  const pending = [...migrations.keys()].filter((name) => !applied.has(name)).sort();
  if (complete && pending.length) throw new Error('Expected migrations were not applied');
  return pending;
}

// Pure verification only: this does not grant production execution authority.
// The deployment caller must also pass assertReconciliationRequested and the
// catalog/data preflight. The pinned manifest remains unapproved for production.
export function checkReconciledHistory(bundle, rows, target, complete = false) {
  const files = verifyPackage(bundle);
  const bytes = files.get(reconciliationPaths[0]);
  if (!bytes || digest(bytes) !== reconciliationDigest) throw new Error('Unreviewed reconciliation manifest');
  const manifest = JSON.parse(bytes);
  if (target.hostname !== manifest.target.hostname || target.database !== manifest.target.database ||
      Number(target.port) !== manifest.target.port) throw new Error('Reconciliation target mismatch');
  for (const [path, checksum] of Object.entries(manifest.evidenceSha256)) {
    if (!files.has(path) || digest(files.get(path)) !== checksum) throw new Error('Reconciliation evidence mismatch');
  }
  const migrations = bundle.files.filter((file) => migrationPath.test(file.path));
  if (migrations.length !== manifest.afterStaffCount ||
      migrations.filter((file) => !file.path.match(migrationPath)[1].startsWith('20261102')).length !== manifest.baselineCount) {
    throw new Error('Reconciliation release migration set changed');
  }
  // Reject partial, missing or duplicate ledgers, including rolled-back entries.
  if (rows.length !== (complete ? manifest.afterStaffCount : manifest.baselineCount) ||
      rows.some((row) => row.rolled_back_at || !row.finished_at ||
        (!complete && row.migration_name.startsWith('20261102')))) {
    throw new Error('Reconciliation ledger shape changed');
  }
  const seen = new Set();
  const normalized = rows.map((row) => {
    const exception = manifest.exceptions[row.migration_name];
    if (!exception) return row;
    const file = migrations.find((file) => file.path === `server/prisma/migrations/${row.migration_name}/migration.sql`);
    if (!file || file.sha256 !== exception.availableChecksum || row.checksum !== exception.recordedChecksum ||
        seen.has(row.migration_name)) throw new Error('Reconciliation checksum pair changed');
    seen.add(row.migration_name);
    // Compare a copy in memory; never rewrite the database ledger or package.
    return { ...row, checksum: exception.availableChecksum };
  });
  if (seen.size !== 4) throw new Error('Expected all four historical mismatches');
  return checkHistory(bundle, normalized, complete);
}

export function checksForPending(files, pending) {
  const plan = JSON.parse(files.get('server/prisma/deployment-checks.json'));
  if (plan.version !== 1) throw new Error('Invalid migration review plan');
  const selected = new Map();
  for (const name of pending) {
    const review = plan.migrations[name];
    if (!review || !['schema', 'data'].includes(review.kind) || !review.reason?.trim() ||
      !Array.isArray(review.checks) || !review.checks.length) {
      throw new Error(`Missing reviewed before/after checks: ${name}`);
    }
    for (const id of review.checks) {
      const check = plan.checks[id];
      if (!check || typeof check.sql !== 'string' || !check.sql.trim() ||
        !['unchanged', 'expected'].includes(check.rule) ||
        (check.rule === 'expected' && (!Object.hasOwn(check, 'before') || !Object.hasOwn(check, 'after'))) ||
        (review.kind === 'data' && check.rule !== 'expected')) {
        throw new Error(`Invalid aggregate check: ${id}`);
      }
      selected.set(id, check);
    }
  }
  return [...selected];
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [, , ref, output] = process.argv;
  if (!ref || !output || process.argv.length !== 4) throw new Error('Usage: migration-package.mjs COMMIT OUTPUT');
  const bytes = Buffer.from(`${JSON.stringify(buildPackage(ref), null, 2)}\n`);
  writeFileSync(output, bytes, { flag: 'wx', mode: 0o600 });
  console.log(`Package SHA-256 ${digest(bytes)}`);
}
