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
