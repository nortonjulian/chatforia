import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { runPreflight } from './staff-deployment-preflight.mjs';
import { loadReconciliationManifest } from '../security/staffMigrationReconciliation.js';

const source = 'server/prisma/migrations';
const v2Commit = 'dbf5887ebf64d87a649a8a033e5b66b1539b7b7e';
const consent = '20261106010000_twilio_compliance_event_sid';
const names = execFileSync('git', ['ls-tree', '-r', '--name-only', v2Commit, '--', source],
  { encoding: 'utf8' }).split('\n').filter((path) => path.endsWith('/migration.sql'))
  .map((path) => path.split('/').at(-2)).sort();
const checksum = (path) => createHash('sha256').update(readFileSync(path)).digest('hex');
const row = (root, name) => ({
  migration_name: name, checksum: checksum(join(root, name, 'migration.sql')),
  finished_at: new Date(),
});
const database = 'synthetic_staff_preflight';
const env = { STAFF_EXPECTED_DATABASE: database };
const mockDb = (rows) => ({
  $transaction: async (fn) => fn({
    $executeRaw: async () => 0,
    $queryRaw: async (parts) => {
      const query = parts.join('');
      if (query.includes('current_database()')) return [{ name: database }];
      if (query.includes('current_setting(\'server_version_num\')')) return [{ prerequisites: true }];
      if (query.includes('FROM public._prisma_migrations')) return rows;
      throw new Error('Unexpected synthetic query');
    },
  }),
});

test('preflight verifies the exact 161 release while retaining the 160-file path', async () => {
  assert.equal(names.length, 161);
  assert.equal(loadReconciliationManifest({ manifestVersion: 'v1' }).afterStaffCount, 160);
  assert.equal(loadReconciliationManifest({ manifestVersion: 'v2' }).afterStaffCount, 161);
  const root = mkdtempSync(join(tmpdir(), 'staff-migration-161-'));
  try {
    cpSync(join(source, 'migration_lock.toml'), join(root, 'migration_lock.toml'));
    for (const name of names) cpSync(join(source, name), join(root, name), { recursive: true });
    const full = names.map((name) => row(root, name));
    const baseline = full.filter(({ migration_name }) => migration_name < '20261102');
    assert.equal(baseline.length, 141);
    await runPreflight(mockDb(baseline), env, '--before-migrations', { migrationRoot: root });
    await runPreflight(mockDb(full), env, '--after-migrations', { migrationRoot: root });
    for (const bad of [full.slice(1), [...full, full[0]],
      full.map((entry) => entry.migration_name === consent
        ? { ...entry, checksum: 'f'.repeat(64) } : entry)]) {
      await assert.rejects(runPreflight(mockDb(bad), env, '--after-migrations',
        { migrationRoot: root }), /Migration history/);
    }

    const consentPath = join(root, consent, 'migration.sql');
    const consentBytes = readFileSync(consentPath);
    writeFileSync(consentPath, Buffer.concat([consentBytes, Buffer.from('\n-- altered\n')]));
    await assert.rejects(runPreflight(mockDb(full), env, '--after-migrations',
      { migrationRoot: root }), /Required exact migration file changed/);
    writeFileSync(consentPath, consentBytes);

    const extra = join(root, '99999999_extra');
    mkdirSync(extra);
    writeFileSync(join(extra, 'migration.sql'), 'SELECT 1;');
    await assert.rejects(runPreflight(mockDb(full), env, '--after-migrations',
      { migrationRoot: root }), /Migration history/);
    rmSync(extra, { recursive: true });

    rmSync(join(root, consent), { recursive: true });
    const legacy = full.filter(({ migration_name }) => migration_name !== consent);
    await runPreflight(mockDb(legacy), env, '--after-migrations', { migrationRoot: root });
    await assert.rejects(runPreflight(mockDb(full), env, '--after-migrations',
      { migrationRoot: root, manifestVersion: 'v2' }), /Migration history/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
