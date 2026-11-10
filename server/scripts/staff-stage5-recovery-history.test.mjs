import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  buildPackage,
  checkReconciledHistory,
  reconciliationPackageSpec,
  verifyPackage,
} from './migration-package.mjs';
import {
  checkStage5RecoveryHistory,
  loadStage5RecoveryManifest,
} from './staff-stage5-recovery-history.mjs';

const manifest = loadStage5RecoveryManifest();
const bundle = buildPackage(manifest.releaseCommit);
const v2 = reconciliationPackageSpec(verifyPackage(bundle)).manifest;
const migrations = bundle.files
  .filter((file) =>
    /^server\/prisma\/migrations\/\d[^/]+\/migration\.sql$/.test(file.path)
  )
  .map((file) => ({ name: file.path.split('/')[3], checksum: file.sha256 }));
const row = ({ name, checksum }, id = name) => ({
  id,
  migration_name: name,
  checksum: v2.exceptions[name]?.recordedChecksum || checksum,
  finished_at: '2026-11-10T14:20:00Z',
  rolled_back_at: null,
});
const historical = manifest.preexistingRolledBackRows.map((entry) => ({
  id: entry.id,
  migration_name: entry.name,
  checksum: entry.checksum,
  finished_at: null,
  rolled_back_at: '2026-10-01T00:00:00Z',
}));
const baseline = migrations
  .filter(({ name }) => name < '20261102')
  .map((entry) => row(entry));
const newRows = manifest.completedNewMigrations.map((entry) => ({
  id: entry.id,
  migration_name: entry.name,
  checksum: entry.checksum,
  finished_at: '2026-11-10T14:27:00Z',
  rolled_back_at: null,
}));
const failed = {
  id: manifest.failedMigration.id,
  migration_name: manifest.failedMigration.name,
  checksum: manifest.failedMigration.checksum,
  finished_at: null,
  rolled_back_at: null,
};
const before = [...baseline, ...historical, ...newRows, failed];

test('Stage 5 recovery accepts only the pinned 143/3/1 incident ledger and exact remaining sequence', () => {
  const pending = checkStage5RecoveryHistory(
    bundle,
    before,
    manifest.target,
    manifest,
    'failed'
  );
  assert.equal(pending.length, 18);
  assert.equal(pending[0], manifest.failedMigration.name);
  assert.throws(
    () => checkReconciledHistory(bundle, before, manifest.target),
    /ledger shape changed/
  );
  const resolved = structuredClone(before);
  resolved.at(-1).rolled_back_at = '2026-11-10T14:40:00Z';
  assert.deepEqual(
    checkStage5RecoveryHistory(
      bundle,
      resolved,
      manifest.target,
      manifest,
      'resolved'
    ),
    pending
  );
  const complete = [
    ...resolved,
    ...migrations
      .filter(({ name }) => pending.includes(name))
      .map((entry) => row(entry, `new-${entry.name}`)),
  ];
  assert.deepEqual(
    checkStage5RecoveryHistory(
      bundle,
      complete,
      manifest.target,
      manifest,
      'complete'
    ),
    []
  );
  assert.throws(() =>
    checkStage5RecoveryHistory(
      bundle,
      before,
      manifest.target,
      manifest,
      'complete'
    )
  );
  assert.throws(() =>
    checkStage5RecoveryHistory(
      bundle,
      resolved,
      manifest.target,
      manifest,
      'failed'
    )
  );
});

test('Stage 5 recovery rejects changed target, file, IDs, hashes, ledger shape and extra failure', () => {
  const check = (rows, target = manifest.target, release = bundle) =>
    checkStage5RecoveryHistory(release, rows, target, manifest, 'failed');
  for (const target of [
    { ...manifest.target, hostname: 'other' },
    { ...manifest.target, database: 'other' },
    { ...manifest.target, port: 5432 },
  ]) {
    assert.throws(() => check(before, target));
  }
  for (const mutate of [
    (rows) => {
      rows[0].checksum = 'f'.repeat(64);
    },
    (rows) => {
      rows[0].finished_at = null;
    },
    (rows) => {
      rows[0].id = rows[1].id;
    },
    (rows) => {
      rows.at(-1).checksum = 'f'.repeat(64);
    },
    (rows) => {
      rows.at(-1).id = 'unknown';
    },
    (rows) => {
      rows.at(-2).checksum = 'f'.repeat(64);
    },
    (rows) => {
      rows.at(-1).rolled_back_at = 'now';
    },
    (rows) => {
      rows.push({ ...rows[0], id: 'extra', finished_at: null });
    },
    (rows) => {
      rows.splice(0, 1);
    },
    (rows) => {
      rows[baseline.length].checksum = 'f'.repeat(64);
    },
  ]) {
    const changed = structuredClone(before);
    mutate(changed);
    assert.throws(() => check(changed));
  }
  const changedPackage = structuredClone(bundle);
  changedPackage.files.find((file) =>
    file.path.endsWith(`/${manifest.failedMigration.name}/migration.sql`)
  ).sha256 = 'f'.repeat(64);
  assert.throws(() => check(before, manifest.target, changedPackage));
  assert.throws(() =>
    checkStage5RecoveryHistory(
      bundle,
      before,
      manifest.target,
      { ...manifest, releaseCommit: '0'.repeat(40) },
      'failed'
    )
  );
});
