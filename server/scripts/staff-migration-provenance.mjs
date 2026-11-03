import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');

// Offline only. A matching Git object is a lead for human provenance review,
// never permission to edit the Prisma ledger or bypass deployment preflight.
export function inspectMigration(mismatch, revisions, readRevision, currentBytes) {
  const recorded = mismatch.recordedChecksum;
  if (!/^[0-9a-f]{64}$/.test(recorded))
    throw new Error('Invalid recorded checksum evidence');
  const matches = [];
  for (const revision of revisions) {
    const bytes = readRevision(revision);
    if (bytes && sha(bytes) === recorded) matches.push(revision);
  }
  return {
    migration: mismatch.migration,
    currentMatchesRecorded: sha(currentBytes) === recorded,
    matchingGitRevisions: matches,
    disposition: 'Human review of trusted applied artifact still required',
  };
}

export function inspectRecordedDrift(evidence, git) {
  const rows = evidence?.database?.migrationLedger?.mismatches;
  if (!Array.isArray(rows) || rows.length !== 4)
    throw new Error('Expected exactly four recorded target mismatches');
  return rows.map((row) => {
    if (!/^20\d{6}(?:\d{6})?_[a-z0-9_]+$/.test(row.migration))
      throw new Error('Invalid migration name in evidence');
    const path = `server/prisma/migrations/${row.migration}/migration.sql`;
    const revisions = git('log', ['--all', '--follow', '--format=%H', '--', path])
      .toString()
      .trim()
      .split('\n')
      .filter(Boolean);
    const result = inspectMigration(
      row,
      revisions,
      (rev) => {
        try {
          return git('show', [`${rev}:${path}`]);
        } catch {
          return null;
        }
      },
      readFileSync(path)
    );
    if (sha(readFileSync(path)) !== row.checkoutChecksum)
      throw new Error('Working migration differs from recorded checkout evidence');
    return { ...result, gitRevisionsInspected: revisions.length };
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const evidence = JSON.parse(
      readFileSync('docs/staff-security/evidence/live-infrastructure-inspection.json')
    );
    const result = inspectRecordedDrift(evidence, (command, args) =>
      execFileSync('git', [command, ...args], { stdio: ['ignore', 'pipe', 'ignore'] })
    );
    console.log(JSON.stringify(result, null, 2));
    if (result.some((entry) => !entry.currentMatchesRecorded)) process.exitCode = 2;
  } catch {
    console.error('STOP: offline migration provenance check could not be completed');
    process.exitCode = 1;
  }
}
