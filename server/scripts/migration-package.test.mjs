import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { buildPackage, checkHistory, checkReconciledHistory, checksForPending, digest,
  readPackage, reconciliationPackageSpec, applicationReleaseSpec, verifyPackage } from './migration-package.mjs';
import { aggregateChecks, assertChecks, assertPackageDatasource, deployPackage } from './deploy-migration-package.mjs';

test('package datasource guard ignores comments but rejects extra declarations', () => {
  const schema = readFileSync(new URL('../prisma/schema.prisma', import.meta.url), 'utf8');
  assert.match(schema, /\/\/.*datasource\s+/);
  assert.doesNotThrow(() => assertPackageDatasource(schema));
  assert.throws(() => assertPackageDatasource(`${schema}\n` +
    'datasource extra { provider = "postgresql" url = env("DATABASE_URL") }'),
  /Package datasource requires separate review/);
  const sameLine = schema.replace(/datasource db \{[^}]+\}/,
    'datasource db { provider = "postgresql" url = env("DATABASE_URL") } ' +
    'datasource extra { provider = "postgresql" url = env("DATABASE_URL") }');
  assert.throws(() => assertPackageDatasource(sameLine),
    /Package datasource requires separate review/);
  assert.throws(() => assertPackageDatasource(
    schema.replace('env("DATABASE_URL")', 'env("SHADOW_DATABASE_URL")')),
  /Package datasource requires separate review/);
});

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
  const after = structuredClone(rows);
  for (let i = 0; i < 19; i++) {
    const name = `20261102_fixture_${i}`;
    bundle.files.push(file(`server/prisma/migrations/${name}/migration.sql`, 'SELECT 2;'));
    after.push({ migration_name: name, checksum: digest('SELECT 2;'), finished_at: 'now', rolled_back_at: null });
  }
  const original = JSON.stringify(rows);
  assert.equal(checkReconciledHistory(bundle, rows, manifest.target).length, 19);
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
  for (const path of [reconciliationPaths[0], reconciliationPaths[1],
    `server/prisma/migrations/${rows[0].migration_name}/migration.sql`]) {
    const bad = structuredClone(bundle);
    const index = bad.files.findIndex((f) => f.path === path);
    bad.files[index] = file(path, 'changed'); // even with a recomputed per-file digest
    assert.throws(() => checkReconciledHistory(bad, rows, manifest.target));
  }
});

test('archived v1 release remains exact; v2 accepts only the 161-file consent release', () => {
  const migration = /^server\/prisma\/migrations\/([^/]+)\/migration\.sql$/;
  const entries = (bundle) => bundle.files.flatMap((file) => {
    const match = file.path.match(migration);
    return match ? [{ name: match[1], file }] : [];
  });
  const row = ({ name, file }, manifest) => ({
    migration_name: name,
    checksum: manifest.exceptions[name]?.recordedChecksum || file.sha256,
    finished_at: 'now', rolled_back_at: null,
  });
  const legacy = buildPackage('6a5f06d58c4414b7a0f584eeaede3118d3e9066b');
  const legacySpec = reconciliationPackageSpec(verifyPackage(legacy));
  assert.equal(legacySpec.version, 'v1');
  assert.equal(legacy.files.length, 168);
  assert.equal(entries(legacy).length, 160);
  const legacyBefore = entries(legacy).filter(({ name }) => name < '20261102')
    .map((entry) => row(entry, legacySpec.manifest));
  const legacyAfter = entries(legacy).map((entry) => row(entry, legacySpec.manifest));
  assert.equal(checkReconciledHistory(legacy, legacyBefore, legacySpec.manifest.target).length, 19);
  assert.deepEqual(checkReconciledHistory(legacy, legacyAfter, legacySpec.manifest.target, true), []);
  assert.throws(() => checkHistory(legacy, legacyBefore), /mismatch/);
  assert.throws(() => checkReconciledHistory(legacy, [...legacyBefore,
    { migration_name: 'old_failed', checksum: '0'.repeat(64), finished_at: null,
      rolled_back_at: 'now' }], legacySpec.manifest.target));

  // Keep the original v2 proof tied to its reviewed 161-file main commit.
  const current = buildPackage('dbf5887ebf64d87a649a8a033e5b66b1539b7b7e');
  const spec = reconciliationPackageSpec(verifyPackage(current));
  assert.equal(spec.version, 'v2');
  assert.equal(entries(current).length, 161);
  assert.equal(current.files.length, 169);
  const historical = [1, 2, 3].map((id) => ({
    id: `rolled-back-${id}`, migration_name: `old_failed_${id}`,
    checksum: `${id}`.repeat(64), finished_at: null, rolled_back_at: 'now',
  }));
  const before = [...entries(current).filter(({ name }) => name < '20261102')
    .map((entry) => row(entry, spec.manifest)), ...historical];
  const after = [...entries(current).map((entry) => row(entry, spec.manifest)), ...historical];
  assert.equal(checkReconciledHistory(current, before, spec.manifest.target).length, 20);
  assert.deepEqual(checkReconciledHistory(current, after, spec.manifest.target, true), []);
  assert.throws(() => checkHistory(current, before), /mismatch/);
  const consentPath = 'server/prisma/migrations/20261106010000_twilio_compliance_event_sid/migration.sql';
  const existingPath = entries(current)[0].file.path;
  const mutate = (change) => {
    const bundle = structuredClone(current);
    change(bundle);
    assert.throws(() => checkReconciledHistory(bundle, before, spec.manifest.target));
  };
  mutate((bundle) => { bundle.files = bundle.files.filter((file) => file.path !== consentPath); });
  mutate((bundle) => { bundle.files = bundle.files.filter((file) => file.path !== existingPath); });
  mutate((bundle) => { bundle.files.push({ path: 'server/prisma/migrations/99999999_extra/migration.sql',
    content: Buffer.from('SELECT 1;').toString('base64'), sha256: digest('SELECT 1;') }); });
  for (const path of [consentPath, existingPath]) {
    mutate((bundle) => {
      const file = bundle.files.find((item) => item.path === path);
      file.content = Buffer.from('SELECT 2;').toString('base64');
      file.sha256 = digest('SELECT 2;');
    });
  }
  mutate((bundle) => {
    const file = bundle.files.find((item) => item.path === spec.paths[0]);
    file.content = Buffer.from('{}').toString('base64');
    file.sha256 = digest('{}');
  });
  mutate((bundle) => { bundle.files.push(legacy.files.find((file) =>
    file.path === legacySpec.paths[0])); });
  for (const bad of [
    before.slice(1),
    [...before, before[0]],
    [...before, { migration_name: '99999999_extra', checksum: '0'.repeat(64), finished_at: 'now', rolled_back_at: null }],
    before.filter((entry) => entry.id !== historical[0].id),
    [...before, historical[0]],
    before.map((entry) => entry.migration_name === 'old_failed_1'
      ? { ...entry, finished_at: 'now' } : entry),
  ]) assert.throws(() => checkReconciledHistory(current, bad, spec.manifest.target));
  const badAfter = structuredClone(after);
  badAfter.find((entry) => entry.migration_name === '20261106010000_twilio_compliance_event_sid').checksum = 'f'.repeat(64);
  assert.throws(() => checkReconciledHistory(current, badAfter, spec.manifest.target, true));
});

test('zero-after backfill check accepts a variable baseline but rejects an incomplete backfill', () => {
  const checks = [['legacy', { rule: 'zero-after', after: [{ missing_read_receipt: '0' }] }]];
  assertChecks(checks, { legacy: [{ missing_read_receipt: '37' }] },
    { legacy: [{ missing_read_receipt: '0' }] });
  assert.throws(() => assertChecks(checks, { legacy: [{ missing_read_receipt: '37' }] },
    { legacy: [{ missing_read_receipt: '1' }] }), /After predicate failed/);
});

test('v3 preserves the archived 161/3 source gate and pins the approved 161/4 release', async () => {
  const bundle = buildPackage('a69f5fbc08c920c9146bda8a34454b51b5cc5eb8');
  const files = verifyPackage(bundle);
  const release = applicationReleaseSpec(files);
  const v2 = reconciliationPackageSpec(files).manifest;
  assert.equal(release.status, 'approved-for-production');
  const archivedRecoveryProposal = buildPackage('04e0b96addbe7d1ae63ca556d06d5845b0d8f0d1');
  assert.equal(applicationReleaseSpec(verifyPackage(archivedRecoveryProposal)).status,
    'proposed-not-authorized-for-production');
  const recovery = JSON.parse(readFileSync('server/security/stage5MigrationRecovery.v1.json'));
  assert.deepEqual(release.historicalRolledBackRows,
    [...recovery.preexistingRolledBackRows, recovery.failedMigration]);
  const archivedApproved = buildPackage('56fe5d914231b21608e6ba511daa0088efc501b7');
  const approvedRelease = applicationReleaseSpec(verifyPackage(archivedApproved));
  assert.equal(approvedRelease.status, 'approved-for-production');
  assert.equal(approvedRelease.historicalRolledBackCount, 3);
  const archivedProposal = buildPackage('64904fd76bc487bda6cf2619f5241f2d95cf06e1');
  const archivedFiles = verifyPackage(archivedProposal);
  const priorRelease = applicationReleaseSpec(archivedFiles);
  assert.equal(priorRelease.status, 'proposed-not-authorized-for-production');
  assert.deepEqual({ ...approvedRelease, status: priorRelease.status }, priorRelease);
  const tamperedManifest = structuredClone(bundle);
  const tamperedFile = tamperedManifest.files.find((file) => file.path ===
    'server/security/applicationMigrationRelease.v3.json');
  const original = Buffer.from(tamperedFile.content, 'base64').toString();
  const changed = original.replace('"afterCount": 164', '"afterCount": 165');
  assert.notEqual(changed, original);
  tamperedFile.content = Buffer.from(changed).toString('base64');
  tamperedFile.sha256 = digest(changed);
  assert.throws(() => applicationReleaseSpec(verifyPackage(tamperedManifest)),
    /Unreviewed application release manifest/);
  const migration = /^server\/prisma\/migrations\/([^/]+)\/migration\.sql$/;
  const entries = bundle.files.flatMap((file) => {
    const match = file.path.match(migration);
    return match ? [{ name: match[1], sha256: file.sha256 }] : [];
  });
  assert.equal(entries.length, 164);
  const historical = release.historicalRolledBackRows.map((entry) => ({
    id: entry.id, migration_name: entry.name, checksum: entry.checksum,
    finished_at: null, rolled_back_at: 'now',
  }));
  const row = ({ name, sha256 }) => ({ migration_name: name,
    checksum: v2.exceptions[name]?.recordedChecksum || sha256,
    finished_at: 'now', rolled_back_at: null });
  const before = [...entries.slice(0, 161).map(row), ...historical];
  const after = [...entries.map(row), ...historical];
  const archivedBefore = [...entries.slice(0, 161).map(row), ...historical.slice(0, 3)];
  assert.deepEqual(checkReconciledHistory(archivedApproved, archivedBefore,
    approvedRelease.target), Object.keys(approvedRelease.requiredExactMigrations));
  assert.throws(() => checkReconciledHistory(archivedApproved, before, approvedRelease.target),
    /ledger shape changed/);
  assert.deepEqual(checkReconciledHistory(bundle, before, release.target),
    Object.keys(release.requiredExactMigrations));
  assert.deepEqual(checkReconciledHistory(bundle, after, release.target, true), []);
  assert.equal(checksForPending(files, Object.keys(release.requiredExactMigrations)).length, 5);
  for (const name of [entries[0].name, ...Object.keys(release.requiredExactMigrations)]) {
    const path = `server/prisma/migrations/${name}/migration.sql`;
    const missing = structuredClone(bundle);
    missing.files = missing.files.filter((file) => file.path !== path);
    assert.throws(() => checkReconciledHistory(missing, before, release.target));
    const altered = structuredClone(bundle);
    const file = altered.files.find((item) => item.path === path);
    file.content = Buffer.from('SELECT 1;').toString('base64');
    file.sha256 = digest('SELECT 1;');
    assert.throws(() => checkReconciledHistory(altered, before, release.target));
  }
  const extra = structuredClone(bundle);
  extra.files.push({ path: 'server/prisma/migrations/99999999_extra/migration.sql',
    content: Buffer.from('SELECT 1;').toString('base64'), sha256: digest('SELECT 1;') });
  assert.throws(() => checkReconciledHistory(extra, before, release.target));
  for (const rows of [before.slice(1), [...before, before[0]],
    before.map((entry) => entry.id === historical[3].id
      ? { ...entry, finished_at: 'now' } : entry),
    before.filter((entry) => entry.id !== historical[3].id),
    before.map((entry) => entry.id === historical[3].id
      ? { ...entry, checksum: 'f'.repeat(64) } : entry),
    before.map((entry) => entry.id === historical[3].id
      ? { ...entry, migration_name: 'unexpected_rollback' } : entry),
    before.map((entry) => entry.id === historical[3].id
      ? { ...entry, id: 'unexpected-id' } : entry),
    [...before.filter((entry) => entry.id !== historical[3].id),
      { ...historical[3], id: 'unexpected-id' }],
    [...before, row(entries[161])]])
    assert.throws(() => checkReconciledHistory(bundle, rows, release.target));
  const wrongNewChecksum = structuredClone(after);
  wrongNewChecksum.find((entry) => entry.migration_name === entries.at(-1).name).checksum = 'f'.repeat(64);
  assert.throws(() => checkReconciledHistory(bundle, wrongNewChecksum, release.target, true));
  const directory = mkdtempSync(join(tmpdir(), 'application-release-proposed-'));
  try {
    const packagePath = join(directory, 'package.json');
    const bytes = Buffer.from(JSON.stringify(archivedRecoveryProposal));
    writeFileSync(packagePath, bytes);
    await assert.rejects(deployPackage({ package: packagePath, sha256: digest(bytes) }),
      /production execution is not approved/);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('v4 preserves the proposed 164-to-165 package without production authority', async () => {
  const bundle = buildPackage('ff7dc8c1bcc61ee364fff4c16503098cb38feed7');
  const files = verifyPackage(bundle);
  const release = applicationReleaseSpec(files);
  const v2 = reconciliationPackageSpec(files).manifest;
  assert.equal(release.status, 'proposed-not-authorized-for-production');
  assert.equal(release.beforeCount, 164);
  assert.equal(release.afterCount, 165);
  const entries = bundle.files.filter((f) => /\/migrations\/[^/]+\/migration.sql$/.test(f.path));
  assert.equal(entries.length, 165);
  const historical = release.historicalRolledBackRows.map((r) => ({ id:r.id,
    migration_name:r.name, checksum:r.checksum, finished_at:null, rolled_back_at:'now' }));
  const rows = entries.map((f) => { const name=f.path.split('/').at(-2); return {
    migration_name:name, checksum:v2.exceptions[name]?.recordedChecksum || f.sha256,
    finished_at:'now', rolled_back_at:null }; });
  const before = [...rows.slice(0,164), ...historical];
  assert.deepEqual(checkReconciledHistory(bundle, before, release.target), Object.keys(release.requiredExactMigrations));
  assert.deepEqual(checkReconciledHistory(bundle, [...rows,...historical], release.target, true), []);
  assert.throws(() => checkReconciledHistory(bundle, [...rows.slice(0,161),...historical], release.target));
  assert.equal(checksForPending(files, Object.keys(release.requiredExactMigrations)).length, 2);
  for (const target of ['server/security/applicationMigrationRelease.v4.json', entries.at(-1).path]) {
    const bad=structuredClone(bundle); const file=bad.files.find((f)=>f.path===target);
    file.content=Buffer.from('{}').toString('base64'); file.sha256=digest('{}');
    assert.throws(()=>checkReconciledHistory(bad,before,release.target));
  }
  const extra=structuredClone(bundle);
  extra.files.push({path:'server/prisma/migrations/99999999_extra/migration.sql',content:Buffer.from('SELECT 1;').toString('base64'),sha256:digest('SELECT 1;')});
  assert.throws(()=>checkReconciledHistory(extra,before,release.target));
  const directory=mkdtempSync(join(tmpdir(),'mfa-release-proposal-'));
  try {
    const path=join(directory,'package.json'); const bytes=Buffer.from(JSON.stringify(bundle));
    writeFileSync(path,bytes);
    await assert.rejects(deployPackage({package:path,sha256:digest(bytes)}), /production execution is not approved/);
  } finally { rmSync(directory,{recursive:true,force:true}); }
});


test('approved v4 retains exact migration bytes and rejects unpinned approval edits', () => {
  const before = buildPackage('ff7dc8c1bcc61ee364fff4c16503098cb38feed7');
  const current = buildPackage('edabf1aa2c5669eb7188afdc5f0f890308ece52e');
  const previous = applicationReleaseSpec(verifyPackage(before));
  const release = applicationReleaseSpec(verifyPackage(current));
  assert.equal(release.status, 'approved-for-production');
  assert.deepEqual({...release,status:previous.status},previous);
  assert.deepEqual(current.files.filter(f=>f.path.endsWith('/migration.sql')),before.files.filter(f=>f.path.endsWith('/migration.sql')));
  const tampered=structuredClone(current);
  const file=tampered.files.find(f=>f.path.endsWith('applicationMigrationRelease.v4.json'));
  const bytes=Buffer.from(Buffer.from(file.content,'base64').toString().replace('"afterCount": 165','"afterCount": 166'));
  file.content=bytes.toString('base64');file.sha256=digest(bytes);
  assert.throws(()=>applicationReleaseSpec(verifyPackage(tampered)),/Unreviewed MFA release/);
});

test('proposed v5 pins only eSIM migration 166 after the approved 165 recovery', async () => {
  const prior = buildPackage('aa4b4e040464336033ed8f9679290e727d58e7a6');
  const priorFiles = verifyPackage(prior);
  const priorRelease = applicationReleaseSpec(priorFiles);
  const bundle = buildPackage('HEAD');
  const files = verifyPackage(bundle);
  const release = applicationReleaseSpec(files);
  const esimName = '20261113010000_add_esim_operation_lock';
  assert.equal(priorRelease.status, 'approved-for-production');
  assert.equal(release.status, 'proposed-not-authorized-for-production');
  assert.equal(release.beforeCount, 165);
  assert.equal(release.afterCount, 166);
  assert.deepEqual(Object.keys(release.requiredExactMigrations), [esimName]);
  assert.deepEqual(files.get('server/security/applicationMigrationRelease.v4.json'),
    priorFiles.get('server/security/applicationMigrationRelease.v4.json'));
  assert.equal(digest(files.get(`server/prisma/migrations/${esimName}/migration.sql`)),
    release.requiredExactMigrations[esimName]);
  const entries = bundle.files.filter((file) => /\/migrations\/[^/]+\/migration.sql$/.test(file.path));
  assert.equal(entries.length, 166);
  const exceptions = reconciliationPackageSpec(files).manifest.exceptions;
  const active = entries.map((file, index) => {
    const migration_name = file.path.split('/').at(-2);
    return { id: `active-${index}`, migration_name,
      checksum: exceptions[migration_name]?.recordedChecksum || file.sha256,
      finished_at: 'now', rolled_back_at: null };
  });
  const historical = release.historicalRolledBackRows.map((row) => ({
    id: row.id, migration_name: row.name, checksum: row.checksum,
    finished_at: null, rolled_back_at: 'now',
  }));
  const before = [...active.filter((row) => row.migration_name !== esimName), ...historical];
  const after = [...active, ...historical];
  assert.deepEqual(checkReconciledHistory(bundle, before, release.target), [esimName]);
  assert.deepEqual(checkReconciledHistory(bundle, after, release.target, true), []);
  assert.throws(() => checkReconciledHistory(bundle,
    before.filter((row) => row.migration_name !== '20261114050000_authorized_mfa_disable'),
    release.target));
  assert.throws(() => checkReconciledHistory(bundle,
    before.map((row) => row.migration_name === '20261114050000_authorized_mfa_disable'
      ? { ...row, checksum: 'f'.repeat(64) } : row), release.target));
  assert.deepEqual(checksForPending(files, [esimName]).map(([id]) => id),
    ['preserve_user_count', 'esim_operation_lock_exists']);
  const alteredSql = structuredClone(bundle);
  const sql = alteredSql.files.find((file) => file.path ===
    `server/prisma/migrations/${esimName}/migration.sql`);
  sql.content = Buffer.from('SELECT 1;').toString('base64');
  sql.sha256 = digest('SELECT 1;');
  assert.throws(() => checkReconciledHistory(alteredSql, before, release.target));
  const alteredManifest = structuredClone(bundle);
  const manifest = alteredManifest.files.find((file) => file.path ===
    'server/security/applicationMigrationRelease.v5.json');
  const bytes = Buffer.from(manifest.content, 'base64').toString()
    .replace('proposed-not-authorized-for-production', 'approved-for-production');
  manifest.content = Buffer.from(bytes).toString('base64');
  manifest.sha256 = digest(bytes);
  assert.throws(() => applicationReleaseSpec(verifyPackage(alteredManifest)),
    /Unreviewed eSIM release manifest/);
  const directory = mkdtempSync(join(tmpdir(), 'esim-release-proposal-'));
  try {
    const path = join(directory, 'package.json');
    const packageBytes = Buffer.from(JSON.stringify(bundle));
    writeFileSync(path, packageBytes);
    await assert.rejects(deployPackage({ package: path, sha256: digest(packageBytes) }),
      /production execution is not approved/);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
