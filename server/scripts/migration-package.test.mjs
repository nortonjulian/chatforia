import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { buildPackage, checkHistory, checksForPending, digest, readPackage, verifyPackage } from './migration-package.mjs';
import { aggregateChecks, assertChecks } from './deploy-migration-package.mjs';

test('package uses committed bytes and rejects tampering, duplicates and traversal', () => {
  const directory = mkdtempSync(join(tmpdir(), 'migration-package-test-'));
  try {
    const git = (...args) => execFileSync('git', args, { cwd: directory, stdio: 'pipe' }).toString().trim();
    git('init'); git('config', 'user.name', 'Fixture'); git('config', 'user.email', 'fixture@example.invalid');
    const fixtures = { 'server/prisma/schema.prisma': 'schema',
      'server/prisma/migrations/001/migration.sql': 'SELECT 1;\r\n',
      'server/prisma/migrations/migration_lock.toml': 'provider = "postgresql"',
      'server/prisma/deployment-checks.json': '{"version":1}', 'package-lock.json': '{}' };
    for (const [path, bytes] of Object.entries(fixtures)) {
      mkdirSync(join(directory, path, '..'), { recursive: true });
      writeFileSync(join(directory, path), bytes);
    }
    git('add', '.'); git('commit', '-m', 'fixture');
    writeFileSync(join(directory, 'server/prisma/migrations/001/migration.sql'), 'DIRTY');
    const bundle = buildPackage('HEAD', directory);
    assert.equal(verifyPackage(bundle).get('server/prisma/migrations/001/migration.sql').toString(), 'SELECT 1;\r\n');
    const output = join(directory, 'bundle.json');
    writeFileSync(output, JSON.stringify(bundle));
    assert.deepEqual(readPackage(output, digest(readFileSync(output))), bundle);
    assert.throws(() => readPackage(output, 'a'.repeat(64)));
    const altered = structuredClone(bundle);
    altered.files[0].content = Buffer.from('changed').toString('base64');
    assert.throws(() => verifyPackage(altered));
    const duplicate = structuredClone(bundle);
    duplicate.files.push(duplicate.files[0]);
    assert.throws(() => verifyPackage(duplicate));
    const traversal = structuredClone(bundle);
    traversal.files[0].path = '../escape';
    assert.throws(() => verifyPackage(traversal));
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('ledger rejects changed, unknown, duplicate and unfinished applied migrations', () => {
  const bundle = { files: [1, 2].map((n) => ({ path: `server/prisma/migrations/00${n}/migration.sql`, sha256: String(n) })) };
  const row = { migration_name: '001', checksum: '1', finished_at: 'now', rolled_back_at: null };
  assert.deepEqual(checkHistory(bundle, [row]), ['002']);
  for (const change of [{ checksum: 'changed' }, { migration_name: 'unknown' }, { finished_at: null }]) {
    assert.throws(() => checkHistory(bundle, [{ ...row, ...change }]));
  }
  assert.throws(() => checkHistory(bundle, [row, row]));
  assert.throws(() => checkHistory(bundle, [row], true));
  assert.deepEqual(checkHistory(bundle, [row, { ...row, migration_name: '002', checksum: '2' }], true), []);
  assert.deepEqual(checkHistory(bundle, [{ ...row, rolled_back_at: 'now' }]), ['001', '002']);
});

test('every pending migration requires a review; data updates require expected aggregates', () => {
  const plan = { version: 1, migrations: { '001': { kind: 'data', reason: 'Refund backfill', checks: ['refunds'] } },
    checks: { refunds: { sql: 'SELECT 1', rule: 'expected', before: [{ total: 0 }], after: [{ total: 10 }] } } };
  const files = () => new Map([['server/prisma/deployment-checks.json', Buffer.from(JSON.stringify(plan))]]);
  const checks = checksForPending(files(), ['001']);
  assertChecks(checks, { refunds: [{ total: 0 }] }, { refunds: [{ total: 10 }] });
  assert.throws(() => assertChecks(checks, { refunds: [{ total: 2 }] }));
  assert.throws(() => assertChecks(checks, { refunds: [{ total: 0 }] }, { refunds: [{ total: 9 }] }));
  assert.throws(() => checksForPending(files(), ['002']));
  plan.checks.refunds.rule = 'unchanged';
  assert.throws(() => checksForPending(files(), ['001']));
});

test('aggregate queries execute inside a read-only transaction and detect changed counts', async () => {
  const statements = [];
  const db = { $transaction: async (fn) => fn({
    $executeRawUnsafe: async (sql) => statements.push(sql),
    $queryRawUnsafe: async (sql) => { assert.match(statements[0], /READ ONLY/); statements.push(sql); return [{ count: '5' }]; },
  }) };
  const checks = [['users', { sql: 'SELECT count(*)::text FROM "User"', rule: 'unchanged' }]];
  const result = await aggregateChecks(db, checks);
  assertChecks(checks, result, result);
  assert.throws(() => assertChecks(checks, result, { users: [{ count: '4' }] }));
});

test('pinned reconciliation accepts only the exact four pairs and target, before and after', async () => {
  const { checkReconciledHistory, reconciliationPaths } = await import('./migration-package.mjs');
  const file = (path, bytes) => ({ path, sha256: digest(bytes), content: Buffer.from(bytes).toString('base64') });
  const bundle = { version: 1, commit: 'a'.repeat(40), files: [
    file('server/prisma/schema.prisma', 'schema'),
    file('server/prisma/migrations/migration_lock.toml', 'provider="postgresql"'),
    file('server/prisma/deployment-checks.json', '{"version":1}'),
    file('package-lock.json', '{}'),
    ...reconciliationPaths.map((path) => file(path, readFileSync(path))),
  ] };
  const manifest = JSON.parse(readFileSync(reconciliationPaths[0]));
  const rows = [];
  for (const [name, pair] of Object.entries(manifest.exceptions)) {
    const path = `server/prisma/migrations/${name}/migration.sql`;
    bundle.files.push(file(path, readFileSync(path)));
    rows.push({ migration_name: name, checksum: pair.recordedChecksum, finished_at: 'now', rolled_back_at: null });
  }
  for (let i = 0; i < 137; i++) {
    const name = `20260101_fixture_${i}`;
    bundle.files.push(file(`server/prisma/migrations/${name}/migration.sql`, 'SELECT 1;'));
    rows.push({ migration_name: name, checksum: digest('SELECT 1;'), finished_at: 'now', rolled_back_at: null });
  }
  for (let i = 0; i < 3; i++) {
    rows.push({ migration_name: `20260101_fixture_${i}`, checksum: 'e'.repeat(64),
      finished_at: null, rolled_back_at: 'historical' });
  }
  const after = structuredClone(rows);
  for (let i = 0; i < 19; i++) {
    const name = `20261102090000_fixture_${i}`;
    bundle.files.push(file(`server/prisma/migrations/${name}/migration.sql`, 'SELECT 2;'));
    after.push({ migration_name: name, checksum: digest('SELECT 2;'), finished_at: 'now', rolled_back_at: null });
  }
  const twilioName = '20261106010000_twilio_compliance_event_sid';
  const twilioPath = `server/prisma/migrations/${twilioName}/migration.sql`;
  const twilioSql = readFileSync(twilioPath);
  assert.equal(digest(twilioSql), manifest.requiredExactMigrations[twilioName]);
  bundle.files.push(file(twilioPath, twilioSql));
  after.push({ migration_name: twilioName, checksum: digest(twilioSql), finished_at: 'now', rolled_back_at: null });
  const original = JSON.stringify(rows);
  assert.equal(checkReconciledHistory(bundle, rows, manifest.target).length, 20);
  assert.deepEqual(checkReconciledHistory(bundle, after, manifest.target, true), []);
  assert.equal(JSON.stringify(rows), original, 'checker must not change recorded checksums');
  assert.throws(() => checkHistory(bundle, rows), /mismatch/, 'strict default still rejects the four');
  for (const patch of [{ hostname: 'other' }, { database: 'other' }, { port: 5432 }]) {
    assert.throws(() => checkReconciledHistory(bundle, rows, { ...manifest.target, ...patch }));
  }
  for (const index of [0, 4]) { // changed allowed pair and fifth mismatch
    const bad = structuredClone(rows); bad[index].checksum = 'f'.repeat(64);
    assert.throws(() => checkReconciledHistory(bundle, bad, manifest.target));
  }
  for (const patch of [{ finished_at: null }, { rolled_back_at: 'now' }, { migration_name: 'unknown' }]) {
    const bad = structuredClone(rows); Object.assign(bad[0], patch);
    assert.throws(() => checkReconciledHistory(bundle, bad, manifest.target));
  }
  assert.throws(() => checkReconciledHistory(bundle, rows.slice(1), manifest.target));
  assert.throws(() => checkReconciledHistory(bundle, [...rows, rows[0]], manifest.target));
  const duplicate = structuredClone(rows); duplicate[5] = duplicate[4];
  assert.throws(() => checkReconciledHistory(bundle, duplicate, manifest.target));
  assert.throws(() => checkReconciledHistory(bundle, after.slice(1), manifest.target, true));
  const missingHistorical = rows.filter((row, index) => index !== 141);
  assert.throws(() => checkReconciledHistory(bundle, missingHistorical, manifest.target));
  const extraHistorical = [...rows, rows[141]];
  assert.throws(() => checkReconciledHistory(bundle, extraHistorical, manifest.target));
  const finishedHistorical = structuredClone(rows);
  finishedHistorical[141].finished_at = 'now';
  assert.throws(() => checkReconciledHistory(bundle, finishedHistorical, manifest.target));
  const changedTwilioLedger = structuredClone(after);
  changedTwilioLedger.at(-1).checksum = 'f'.repeat(64);
  assert.throws(() => checkReconciledHistory(bundle, changedTwilioLedger, manifest.target, true));
  for (const path of [reconciliationPaths[0], reconciliationPaths[1],
    `server/prisma/migrations/${rows[0].migration_name}/migration.sql`, twilioPath]) {
    const bad = structuredClone(bundle);
    const index = bad.files.findIndex((f) => f.path === path);
    bad.files[index] = file(path, 'changed'); // even with a recomputed per-file digest
    assert.throws(() => checkReconciledHistory(bad, rows, manifest.target));
  }
});
