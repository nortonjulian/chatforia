import { readFileSync } from 'node:fs';
import {
  checkHistory,
  digest,
  reconciliationPackageSpec,
  verifyPackage,
} from './migration-package.mjs';

const manifestPath = 'server/security/stage5MigrationRecovery.v1.json';
const manifestSha256 =
  'f7dbbe06d74a3736a6e09020d2c99980a15b12c563ab9eb15833be228b4cbb71';
const foundation = '20261102070000_staff_security_foundation';

export function loadStage5RecoveryManifest() {
  const bytes = readFileSync(manifestPath);
  if (digest(bytes) !== manifestSha256)
    throw new Error('Stage 5 recovery manifest changed');
  const manifest = JSON.parse(bytes);
  if (
    manifest.status !== 'prepared-not-authorized-for-production' ||
    manifest.id !== 'chatforia-c103-foundation-20261110-recovery-v1' ||
    manifest.completedNewMigrations.length !== 2 ||
    manifest.preexistingRolledBackRows.length !== 3 ||
    manifest.failedMigration.name !== foundation
  ) {
    throw new Error('Unreviewed Stage 5 recovery manifest');
  }
  return manifest;
}

const sameRow = (row, expected) =>
  row?.id === expected.id &&
  row.migration_name === expected.name &&
  row.checksum === expected.checksum;

// Pure, read-only ledger check. The failed record is preserved in every phase.
// This does not authorize production execution or alter the v2 default gate.
export function checkStage5RecoveryHistory(
  bundle,
  rows,
  target,
  manifest,
  phase
) {
  if (!['failed', 'resolved', 'complete'].includes(phase))
    throw new Error('Invalid recovery phase');
  const files = verifyPackage(bundle);
  const spec = reconciliationPackageSpec(files);
  if (
    spec.version !== 'v2' ||
    bundle.commit !== manifest.releaseCommit ||
    spec.manifest.id !== manifest.reconciliationId ||
    target.hostname !== manifest.target.hostname ||
    target.database !== manifest.target.database ||
    Number(target.port) !== manifest.target.port ||
    spec.manifest.target.hostname !== manifest.target.hostname ||
    spec.manifest.target.database !== manifest.target.database ||
    Number(spec.manifest.target.port) !== manifest.target.port
  ) {
    throw new Error('Recovery release or target differs');
  }
  if (
    !Array.isArray(rows) ||
    rows.length !== (phase === 'complete' ? 165 : 147) ||
    new Set(rows.map((row) => row.id)).size !== rows.length
  ) {
    throw new Error('Recovery ledger row count or ID differs');
  }
  const failed = rows.filter((row) => row.id === manifest.failedMigration.id);
  if (
    failed.length !== 1 ||
    !sameRow(failed[0], manifest.failedMigration) ||
    failed[0].finished_at ||
    Boolean(failed[0].rolled_back_at) !== (phase !== 'failed')
  ) {
    throw new Error('Failed migration record differs');
  }
  const rolled = rows.filter(
    (row) => row.rolled_back_at && row.id !== manifest.failedMigration.id
  );
  if (
    rolled.length !== 3 ||
    rolled.some((row) => row.finished_at) ||
    manifest.preexistingRolledBackRows.some(
      (expected) => !rolled.some((row) => sameRow(row, expected))
    )
  ) {
    throw new Error('Historical rolled-back records differ');
  }
  const active = rows.filter((row) => row.finished_at && !row.rolled_back_at);
  if (
    active.length !== (phase === 'complete' ? 161 : 143) ||
    rows.some(
      (row) =>
        !row.finished_at && !row.rolled_back_at && row.id !== failed[0].id
    ) ||
    manifest.completedNewMigrations.some(
      (expected) => !active.some((row) => sameRow(row, expected))
    )
  ) {
    throw new Error('Active or unfinished recovery ledger differs');
  }
  const seen = new Set();
  const normalized = active.map((row) => {
    const pair = spec.manifest.exceptions[row.migration_name];
    if (!pair) return row;
    const path = `server/prisma/migrations/${row.migration_name}/migration.sql`;
    if (
      row.checksum !== pair.recordedChecksum ||
      digest(files.get(path)) !== pair.availableChecksum ||
      seen.has(row.migration_name)
    )
      throw new Error('Historical checksum pair differs');
    seen.add(row.migration_name);
    return { ...row, checksum: pair.availableChecksum };
  });
  if (seen.size !== 4)
    throw new Error('Four historical checksum pairs required');
  const pending = checkHistory(bundle, normalized, phase === 'complete');
  if (
    phase !== 'complete' &&
    (pending.length !== 18 || pending[0] !== foundation)
  ) {
    throw new Error('Recovery pending migration sequence differs');
  }
  return pending;
}
