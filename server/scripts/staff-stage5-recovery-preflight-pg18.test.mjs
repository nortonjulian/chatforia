import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PrismaClient } from '@prisma/client';
import { stage5RecoveryPreflight } from './staff-stage5-recovery-preflight.mjs';
import { loadStage5RecoveryManifest } from './staff-stage5-recovery-history.mjs';

assert.equal(process.env.STAFF_STAGE5_SYNTHETIC_PG18, 'yes');
const url = new URL(process.env.DATABASE_URL);
assert.equal(url.hostname, '127.0.0.1');
assert.equal(url.pathname, '/defaultdb');
assert.equal(url.username, 'doadmin_probe');
const db = new PrismaClient({
  log: [],
  datasources: { db: { url: url.toString() } },
});
try {
  const phase = process.env.STAFF_STAGE5_PREFLIGHT_PHASE || 'complete';
  assert.ok(['failed', 'resolved', 'complete'].includes(phase));
  const rows = await db.$queryRawUnsafe(`SELECT id, migration_name, checksum,
    finished_at, rolled_back_at FROM public._prisma_migrations`);
  const manifest = structuredClone(loadStage5RecoveryManifest());
  manifest.completedNewMigrations = manifest.completedNewMigrations.map(
    (expected) => {
      const row = rows.find(
        (entry) => entry.migration_name === expected.name && entry.finished_at
      );
      assert.ok(row);
      return { id: row.id, name: row.migration_name, checksum: row.checksum };
    }
  );
  const failed = rows.find(
    (row) =>
      row.migration_name === manifest.failedMigration.name &&
      !row.finished_at &&
      Boolean(row.rolled_back_at) === (phase !== 'failed')
  );
  assert.ok(failed);
  manifest.failedMigration = {
    id: failed.id,
    name: failed.migration_name,
    checksum: failed.checksum,
  };
  manifest.preexistingRolledBackRows = rows
    .filter((row) => row.rolled_back_at && row.id !== failed.id)
    .map((row) => ({
      id: row.id,
      name: row.migration_name,
      checksum: row.checksum,
    }));
  const bundle = JSON.parse(readFileSync('/tmp/c103-recovery-package.json'));
  const result = await stage5RecoveryPreflight(db, bundle, manifest, phase, {
    executorRole: 'doadmin_probe',
  });
  assert.deepEqual(result, {
    phase,
    pending: phase === 'complete' ? 0 : 18,
    ledger:
      phase === 'complete'
        ? '161/4/0'
        : phase === 'resolved'
          ? '143/4/0'
          : '143/3/1',
    catalog: 'verified',
    preserveUserCount: '2',
  });
  console.log(
    `PASS: read-only recovery ${phase}-phase gate validates isolated PostgreSQL 18 catalog, data and runtime boundary`
  );
} finally {
  await db.$disconnect();
}
