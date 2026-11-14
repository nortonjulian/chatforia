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
export const reconciliationPathsV2 = [
  'server/security/staffMigrationReconciliation.v2.json',
  ...reconciliationPaths.slice(1),
];
const reconciliationDigests = {
  v1: 'a59c5f947c0d2059c98f67e85230b74d6ceccfbc9d778e44278680983e2630e5',
  v2: '9d804646458a74c8fa3934db379d0431d166a26aa7104c58d1b42287ffa6c187',
};
const consentMigration = '20261106010000_twilio_compliance_event_sid';
const consentSha256 = '3befceaba8f76df39c15a60cadcd8698f06c03ceee71c263210c62bff6dde78a';
const legacyMigrationSetSha256 = 'ad8b4728d73fffedd8f2f13f20ac587f27c417a086fe7f28aeee2ef939ab382c';
export const applicationReleasePath = 'server/security/applicationMigrationRelease.v3.json';
export const mfaReleasePath = 'server/security/applicationMigrationRelease.v4.json';
export const esimReleasePath = 'server/security/applicationMigrationRelease.v5.json';
const esimReleaseDigests = Object.freeze({
  // A reviewable 165-to-166 proposal. Production authority requires a separate owner approval.
  'a27172c770c418201e00da5a9f13814c8da65ecdc5454331ba2039240ed7451b':
    'proposed-not-authorized-for-production',
});
const mfaReleaseDigests = Object.freeze({
  // Owner approved exact failed-attempt recovery and deployment on 2026-11-14.
  '46e18ede18aaaea2d33879786cf6ce09d6f82e928d40b4faf585214a260b005f': 'approved-for-production',
  // Proposed recovery retains the exact failed attempt as a fifth historical row.
  '24395cb2b8d0a0899e59ea4452869d7d208e0abce1d8b4af5daecdff325a36d9': 'proposed-not-authorized-for-production',
  'c8be058f97a023c9406287ac29bcd1959a28a0cd52eee0ff67e183a497a57585': 'proposed-not-authorized-for-production',
  'ab3462be1d16627b86b6568089928869612986edc3d6f31fb33f7c545dd01b29': 'approved-for-production',
});
const applicationReleaseDigests = Object.freeze({
  // Retain verification of the archived proposed package from merged PR #325.
  '8b853c9f12a775097adae55b657e463871c8a42450ad8eab556815ce21c23045':
    'proposed-not-authorized-for-production',
  // Preserve the approved and archived 56fe release package unchanged.
  'b51ea823ea66f91dd4f5f081bcdb060ce94fcbdf88eddc0d76743699e7ef8a33':
    'approved-for-production',
  // Preserve the distinct four-row proposal before its source-gate approval.
  'e574dccdcdde70893704361507afb513ac77ad8887bd4800d51fe5b8f52ebd0e':
    'proposed-not-authorized-for-production',
  // Owner-approved source gate for the exact four-row recovered ledger.
  '6a5b2271c38b110e6380821198d46565e4d6a1f54decffea29c3683a6adf5741':
    'approved-for-production',
});
const recoveredRolledBackRows = Object.freeze([
  { id: '047afc05-0050-487b-84ec-227f2fa38bb1',
    name: '20260423035728_add_push_provider_to_device',
    checksum: '653008ba99c4a20b37e4251639ad1631691b7b75fbd4db999cf6cd569878c3b9' },
  { id: 'a02e09ba-312d-4a41-9649-b6a6729da10f',
    name: '20260424200440_add_phone_number_inventory_flags',
    checksum: 'e39dd6388de788b8d0c4b753a8643e0919104e129b6d79a4ad2da6f1bdd7aa97' },
  { id: '4e635131-51bf-41a2-bd85-eefd9ee1d25f',
    name: '20260508220249_add_stripe_webhook_events',
    checksum: '82dca46c428c86eb14c3912a95bcd585c9a34e2d65565fd1dc26522b38253bed' },
  { id: '3cba3a9a-c3b5-4d6d-9e1f-28ba5e8016d6',
    name: '20261102070000_staff_security_foundation',
    checksum: '717b13a595b54a7c693147f0509caa527637ec3fa81dbc1bd939e6fe4241d662' },
]);
const allowedPath = (path) => migrationPath.test(path) || [
  'server/prisma/schema.prisma', 'server/prisma/migrations/migration_lock.toml',
  'server/prisma/deployment-checks.json', 'package-lock.json',
  applicationReleasePath, mfaReleasePath, esimReleasePath,
  ...new Set([...reconciliationPaths, ...reconciliationPathsV2]),
].includes(path);

export function migrationSetDigest(entries) {
  return digest(entries.map(({ name, sha256 }) => `${name} ${sha256}\n`).sort().join(''));
}

export function reconciliationPackageSpec(files) {
  const hasV1 = files.has(reconciliationPaths[0]);
  const hasV2 = files.has(reconciliationPathsV2[0]);
  if (hasV1 === hasV2) throw new Error('Expected exactly one reconciliation manifest');
  const version = hasV2 ? 'v2' : 'v1';
  const paths = hasV2 ? reconciliationPathsV2 : reconciliationPaths;
  if (digest(files.get(paths[0])) !== reconciliationDigests[version])
    throw new Error('Unreviewed reconciliation manifest');
  return { version, paths, manifest: JSON.parse(files.get(paths[0])) };
}

function archivedApplicationReleaseSpec(files) {
  if (!files.has(applicationReleasePath)) return null;
  const reviewedStatus = applicationReleaseDigests[digest(files.get(applicationReleasePath))];
  if (!reviewedStatus) throw new Error('Unreviewed application release manifest');
  const manifest = JSON.parse(files.get(applicationReleasePath));
  if (manifest.id !== 'chatforia-sms-quiet-voicemail-20261111-v3' ||
      manifest.status !== reviewedStatus ||
      manifest.basedOnReconciliationManifestSha256 !== reconciliationDigests.v2 ||
      manifest.beforeCount !== 161 || manifest.afterCount !== 164 ||
      !((manifest.historicalRolledBackCount === 3 &&
        manifest.historicalRolledBackRows === undefined) ||
        (manifest.historicalRolledBackCount === 4 &&
        JSON.stringify(manifest.historicalRolledBackRows) === JSON.stringify(recoveredRolledBackRows))) ||
      manifest.beforeMigrationSetSha256 !== '481107cb70b4df1c90fbd4c60dfc28dba01f1c3930f7fdb7ea79babaac0e2c28' ||
      manifest.afterMigrationSetSha256 !== '21896086d07c00ef8f216a500dcd87f76e10a07d7d028774b90b5db13bdf549b' ||
      JSON.stringify(manifest.requiredExactMigrations) !== JSON.stringify({
        '20261109010000_sms_message_read_receipts': '8e99dd90ec1c7e436e1674dc51c9de6dac9816b0a22a4e1b3047461a5fc1973a',
        '20261110010000_forwarding_quiet_hours_time_zone': 'c0ae138a7fe8964998833c2359a6e75b2ad14a309fcc94346a545ebe83ae9626',
        '20261111010000_voicemail_email_delivery_outbox': 'c270299272798d230705c655b268bc3244889174d630b60c289dbb3ec28dfeab',
      })) throw new Error('Application release manifest shape changed');
  return manifest;
}

function mfaApplicationReleaseSpec(files) {
  const previous = archivedApplicationReleaseSpec(files);
  if (!files.has(mfaReleasePath)) return previous;
  const reviewedStatus = mfaReleaseDigests[digest(files.get(mfaReleasePath))];
  if (!previous || !reviewedStatus)
    throw new Error('Unreviewed MFA release manifest');
  const next = JSON.parse(files.get(mfaReleasePath));
  if (next.status !== reviewedStatus ||
      next.basedOnApplicationManifestSha256 !== digest(files.get(applicationReleasePath)) ||
      next.beforeCount !== previous.afterCount ||
      next.beforeMigrationSetSha256 !== previous.afterMigrationSetSha256)
    throw new Error('MFA release baseline mismatch');
  return next;
}

export function applicationReleaseSpec(files) {
  const previous = mfaApplicationReleaseSpec(files);
  if (!files.has(esimReleasePath)) return previous;
  const reviewedStatus = esimReleaseDigests[digest(files.get(esimReleasePath))];
  if (!files.has(mfaReleasePath) || !previous || !reviewedStatus)
    throw new Error('Unreviewed eSIM release manifest');
  const next = JSON.parse(files.get(esimReleasePath));
  if (previous.status !== 'approved-for-production' ||
      next.id !== 'chatforia-esim-operation-lock-20261114-v5' ||
      next.status !== reviewedStatus ||
      next.basedOnMfaManifestSha256 !== digest(files.get(mfaReleasePath)) ||
      next.beforeCount !== previous.afterCount || next.afterCount !== 166 ||
      next.historicalRolledBackCount !== previous.historicalRolledBackCount ||
      JSON.stringify(next.historicalRolledBackRows) !==
        JSON.stringify(previous.historicalRolledBackRows) ||
      next.beforeMigrationSetSha256 !== previous.afterMigrationSetSha256 ||
      next.afterMigrationSetSha256 !==
        '6dada3d377c7fa68cbef08aa129c45410e6caf4cef00f9aac9009c275c2252a9' ||
      JSON.stringify(next.requiredExactMigrations) !== JSON.stringify({
        '20261113010000_add_esim_operation_lock':
          'd6d204b0d34f8c211b2c9c9e60a69cd5826768cfdc93f87ecb5949e76811cbc0',
      }) ||
      JSON.stringify(next.target) !== JSON.stringify(previous.target))
    throw new Error('eSIM release baseline mismatch');
  return next;
}

export function buildPackage(ref, cwd = process.cwd()) {
  const git = (...args) => execFileSync('git', args, { cwd, maxBuffer: 32 * 1024 * 1024 });
  const commit = git('rev-parse', '--verify', `${ref}^{commit}`).toString().trim();
  const entries = git('ls-tree', '-rz', commit, '--', 'server/prisma', 'package-lock.json',
    ...new Set([...reconciliationPaths, ...reconciliationPathsV2,
      applicationReleasePath, mfaReleasePath, esimReleasePath]))
    .toString().split('\0').filter(Boolean);
  const hasConsent = entries.some((entry) => entry.split('\t')[1] ===
    `server/prisma/migrations/${consentMigration}/migration.sql`);
  const excludedManifest = hasConsent ? reconciliationPaths[0] : reconciliationPathsV2[0];
  const files = entries
    .filter((entry) => allowedPath(entry.split('\t')[1]) && entry.split('\t')[1] !== excludedManifest)
    .map((entry) => {
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
  const packaged = new Map(files.map((file) => [file.path, Buffer.from(file.content, 'base64')]));
  if (hasConsent && !packaged.has(reconciliationPathsV2[0]))
    throw new Error('Missing reviewed 161-migration reconciliation manifest');
  if (packaged.has(reconciliationPaths[0]) || packaged.has(reconciliationPathsV2[0]))
    assertReconciliationReleaseSet(bundle, packaged);
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

function assertReconciliationReleaseSet(bundle, files) {
  const { version, manifest } = reconciliationPackageSpec(files);
  const application = applicationReleaseSpec(files);
  if (application && version !== 'v2') throw new Error('Application release requires the exact v2 base');
  for (const [path, checksum] of Object.entries(manifest.evidenceSha256)) {
    if (!files.has(path) || digest(files.get(path)) !== checksum) throw new Error('Reconciliation evidence mismatch');
  }
  const migrations = bundle.files.filter((file) => migrationPath.test(file.path));
  const named = migrations.map((file) => ({ name: file.path.match(migrationPath)[1], sha256: file.sha256 }));
  const newNames = application ? Object.keys(application.requiredExactMigrations) : [];
  const applicationBase = named.filter(({ name }) => !newNames.includes(name));
  const priorNames = [
    ...(files.has(mfaReleasePath)
      ? Object.keys(archivedApplicationReleaseSpec(files).requiredExactMigrations) : []),
    ...(files.has(esimReleasePath)
      ? Object.keys(mfaApplicationReleaseSpec(files).requiredExactMigrations) : []),
  ];
  const base = applicationBase.filter(({ name }) => !priorNames.includes(name));
  const legacy = base.filter(({ name }) => name !== consentMigration);
  if (base.length !== manifest.afterStaffCount ||
      (version === 'v1' && legacy.filter(({ name }) => !name.startsWith('20261102')).length !== manifest.baselineCount) ||
      (version === 'v2' && (
        legacy.length !== 160 ||
        legacy.filter(({ name }) => name < '20261102').length !== manifest.baselineCount ||
        legacy.filter(({ name }) => name.startsWith('20261102')).length !== 19 ||
        manifest.legacyMigrationSetSha256 !== legacyMigrationSetSha256 ||
        migrationSetDigest(legacy) !== legacyMigrationSetSha256 ||
        JSON.stringify(manifest.requiredExactMigrations) !== JSON.stringify({ [consentMigration]: consentSha256 }) ||
        named.find(({ name }) => name === consentMigration)?.sha256 !== consentSha256
      ))) {
    throw new Error('Reconciliation release migration set changed');
  }
  if (application && (
    named.length !== application.afterCount ||
    migrationSetDigest(applicationBase) !== application.beforeMigrationSetSha256 ||
    migrationSetDigest(named) !== application.afterMigrationSetSha256 ||
    newNames.some((name) => named.find((entry) => entry.name === name)?.sha256 !==
      application.requiredExactMigrations[name]) ||
    application.target.hostname !== manifest.target.hostname ||
    application.target.database !== manifest.target.database ||
    application.target.port !== manifest.target.port
  )) throw new Error('Application release migration set changed');
  return { version: application ?
    (files.has(esimReleasePath) ? 'v5' : files.has(mfaReleasePath) ? 'v4' : 'v3') :
    version, manifest, application, migrations };
}

// Pure verification only: this does not grant production execution authority.
// The deployment caller must also pass assertReconciliationRequested and the
// catalog/data preflight. This pure checker grants no production authority.
export function checkReconciledHistory(bundle, rows, target, complete = false) {
  const files = verifyPackage(bundle);
  const { version, manifest, application, migrations } = assertReconciliationReleaseSet(bundle, files);
  if (target.hostname !== manifest.target.hostname || target.database !== manifest.target.database ||
      Number(target.port) !== manifest.target.port) throw new Error('Reconciliation target mismatch');
  // Version 1 retains its original rejection of rolled-back rows. Version 2
  // pins the three observed historical attempts and checks active rows exactly.
  const historical = rows.filter((row) => row.rolled_back_at);
  const active = rows.filter((row) => !row.rolled_back_at);
  const expectedRolledBackCount = application?.historicalRolledBackCount ??
    manifest.historicalRolledBackCount;
  if ((version === 'v1' && historical.length) ||
      (version !== 'v1' && (historical.length !== expectedRolledBackCount ||
        historical.some((row) => row.finished_at))) ||
      (application?.historicalRolledBackRows &&
        (new Set(historical.map((row) => row.id)).size !== historical.length ||
          application.historicalRolledBackRows.some((expected) => !historical.some((row) =>
            row.id === expected.id && row.migration_name === expected.name &&
            row.checksum === expected.checksum)))) ||
      active.length !== (complete ? (application?.afterCount || manifest.afterStaffCount) :
        (application?.beforeCount || manifest.baselineCount)) ||
      active.some((row) => !row.finished_at ||
        (!complete && !application && row.migration_name >= '20261102'))) {
    throw new Error('Reconciliation ledger shape changed');
  }
  const seen = new Set();
  const normalized = active.map((row) => {
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
  const pending = checkHistory(bundle, normalized, complete);
  if (application && !complete && JSON.stringify(pending) !==
      JSON.stringify(Object.keys(application.requiredExactMigrations)))
    throw new Error('Application release baseline differs from reviewed v2 history');
  return pending;
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
    let hasDataCheck = false;
    for (const id of review.checks) {
      const check = plan.checks[id];
      if (!check || typeof check.sql !== 'string' || !check.sql.trim() ||
        !['unchanged', 'expected', 'zero-after'].includes(check.rule) ||
        (check.rule === 'expected' && (!Object.hasOwn(check, 'before') || !Object.hasOwn(check, 'after'))) ||
        (check.rule === 'zero-after' && !Object.hasOwn(check, 'after'))) {
        throw new Error(`Invalid aggregate check: ${id}`);
      }
      if (check.rule === 'expected' || check.rule === 'zero-after') hasDataCheck = true;
      selected.set(id, check);
    }
    if (review.kind === 'data' && !hasDataCheck)
      throw new Error(`Missing data transition check: ${name}`);
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
