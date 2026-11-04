import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHash } from 'node:crypto';
import { inspectMigration } from './staff-migration-provenance.mjs';

const sha = (text) => createHash('sha256').update(text).digest('hex');

test('reports a historical match without treating it as approval', () => {
  const applied = Buffer.from('trusted candidate');
  const result = inspectMigration(
    { migration: 'synthetic', recordedChecksum: sha(applied) },
    ['a', 'b'],
    (revision) => revision === 'a' ? applied : Buffer.from('other'),
    Buffer.from('current')
  );
  assert.deepEqual(result.matchingGitRevisions, ['a']);
  assert.equal(result.currentMatchesRecorded, false);
  assert.match(result.disposition, /Human review/);
});

test('rejects malformed checksum evidence', () => {
  assert.throws(
    () => inspectMigration({ recordedChecksum: 'bad' }, [], () => null, Buffer.alloc(0)),
    /Invalid recorded checksum/
  );
});
