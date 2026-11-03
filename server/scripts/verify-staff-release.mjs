import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

// Read-only release preparation: no network, database, migration or deployment.
const manifest = JSON.parse(
  readFileSync('docs/staff-security/migration-manifest.json', 'utf8')
);
const expected = [
  '20261102090000_protect_staff_user_identity',
  '20261102091000_runtime_role_permissions',
  '20261102092000_protected_credential_recovery',
  '20261102093000_protected_mfa_login',
];
assert.equal(manifest.version, 1);
assert.deepEqual(
  manifest.migrations.map((entry) => entry.name),
  expected
);
for (const { name, sha256 } of manifest.migrations) {
  const bytes = readFileSync(`server/prisma/migrations/${name}/migration.sql`);
  assert.equal(
    createHash('sha256').update(bytes).digest('hex'),
    sha256,
    `Reviewed migration changed: ${name}`
  );
}
const config = readFileSync('docs/staff-security/runtime.env.example', 'utf8');
const deployment = JSON.parse(
  readFileSync('docs/staff-security/deployment-migrations.json', 'utf8')
);
assert.equal(deployment.version, 1);
const deploymentNames = readdirSync('server/prisma/migrations')
  .filter((name) => name.startsWith('20261102'))
  .sort();
assert.equal(deploymentNames.length, 18);
assert.deepEqual(
  deployment.migrations.map(({ name }) => name),
  deploymentNames
);
for (const { name, sha256 } of deployment.migrations) {
  assert.equal(
    createHash('sha256')
      .update(readFileSync(`server/prisma/migrations/${name}/migration.sql`))
      .digest('hex'),
    sha256,
    `Deployment migration changed: ${name}`
  );
}
assert.match(config, /^STAFF_SECURITY_ENABLED=false$/m);
assert.match(config, /^STAFF_DASHBOARD_ENABLED=false$/m);
assert.match(config, /^STAFF_DASHBOARD_USER_IDS=$/m);
assert.match(config, /SESSION_SECRET/);
execFileSync(process.execPath, [
  '--test',
  'server/scripts/staff-migration-provenance.test.mjs',
  'server/scripts/staff-production-prerequisite-roles.static.test.mjs',
], { stdio: 'inherit' });
console.log(
  'PASS: All 18 deployment migration checksums, original four checksums and disabled rollout template'
);
console.log(
  'Local revision:',
  execFileSync('git', ['rev-parse', '--short', 'HEAD'], {
    encoding: 'utf8',
  }).trim()
);
console.log(
  'Release status: HOLD; execution requires separate explicit approval.'
);
