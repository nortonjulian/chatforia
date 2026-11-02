import { spawnSync, execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { userInfo } from 'node:os';
import { resolve } from 'node:path';
import { createStaffAuthorizationAssertion } from '../security/staffAuthorizationAssertion.js';

const root = process.cwd();
const expectedDb = 'chatforia_staff_access_test_20261102';
const dbUrl = process.env.DATABASE_URL;
const branch = execFileSync('git', ['branch', '--show-current'], {
  encoding: 'utf8'
}).trim();

function stop(message) {
  console.error('STOP:', message);
  process.exit(1);
}

if (branch !== 'feature/staff-access-rbac-20261102') {
  stop('Incorrect Git branch.');
}

if (!dbUrl) stop('DATABASE_URL is missing.');

let url;
try {
  url = new URL(dbUrl);
} catch {
  stop('Invalid DATABASE_URL.');
}

if (
  url.protocol !== 'postgresql:' &&
  url.protocol !== 'postgres:'
) stop('Expected PostgreSQL.');

if (
  url.hostname !== '127.0.0.1' ||
  url.pathname !== '/' + expectedDb ||
  url.hash ||
  [...url.searchParams].some(([key, value]) => key !== 'schema' || value !== 'public') ||
  [...url.searchParams].length > 1 ||
  (url.port && url.port !== '5432')
) stop('Refusing to run outside disposable local QA database.');

const report = [];
const dbArgs = [
  '-h', '127.0.0.1', '-p', '5432',
  '-U', userInfo().username, '-d', expectedDb,
  '-X', '-v', 'ON_ERROR_STOP=1', '-P', 'pager=off'
];

function run(name, command, args, options = {}) {
  console.log('\n========== ' + name + ' ==========');
  const started = Date.now();
  const result = spawnSync(command, args, {
    cwd: root,
    stdio: 'inherit',
    ...options
  });
  const passed = result.status === 0 && !result.error;
  report.push({
    name,
    passed,
    durationMs: Date.now() - started
  });
  if (!passed) {
    console.error('STOP: Failed:', name);
    finish();
    process.exit(1);
  }
  console.log('PASS:', name);
}

function finish() {
  const path = '/tmp/chatforia-staff-qa-report.json';
  const jestPassed = report.some(check => check.name === 'Staff security and authentication Jest tests' && check.passed);
  const jest = jestPassed ? JSON.parse(readFileSync('/tmp/chatforia-staff-jest-report.json', 'utf8')) : null;
  writeFileSync(path, JSON.stringify({
    database: expectedDb,
    branch,
    revision: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
    generatedAt: new Date().toISOString(),
    jest: jest ? { passed: jest.numPassedTests, failed: jest.numFailedTests, suites: jest.numTotalTestSuites } : null,
    checks: report
  }, null, 2) + '\n');
  console.log('\nReport:', path);
  console.log('Passed:', report.filter(x => x.passed).length);
  console.log('Failed:', report.filter(x => !x.passed).length);
}

const sql = `
DO $guard$
BEGIN
  IF NOT (
  current_database() = '${expectedDb}'
  AND current_user = '${userInfo().username}'
  AND has_function_privilege(
    'chatforia_dev',
    'staff_security.grant_or_change_staff_access(text,text)',
    'EXECUTE')
  AND has_function_privilege(
    'chatforia_dev',
    'staff_security.revoke_staff_access(text,text)',
    'EXECUTE')
  AND NOT has_function_privilege(
    'chatforia_dev',
    'staff_security.verify_staff_assertion(text)',
    'EXECUTE')
  AND NOT has_function_privilege(
    'chatforia_dev',
    'staff_security.consume_staff_assertion(text)',
    'EXECUTE')
  AND NOT pg_has_role(
    'chatforia_dev', 'chatforia_staff_owner', 'MEMBER')
) THEN
    RAISE EXCEPTION 'Staff security database boundary failed';
  END IF;

  RAISE NOTICE 'PASS: Staff database permission boundary';
END;
$guard$;
`;

run('Database permission boundary', 'psql', [
  ...dbArgs, '-c', sql
]);

run('Rollback-only staff identity protection', 'zsh', [
  resolve(
    root,
    'server/security/db-qa/staff-user-identity-dry-run.sh'
  )
], {
  env: {
    ...process.env
  }
});

// Pending migrations are exercised only in rolled-back transactions.
// This harness never changes persistent migration history.
const migrationDir = resolve(root, 'server/prisma/migrations');
const diskMigrations = new Set(
  readdirSync(migrationDir, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => entry.name)
);

const migrationRows = execFileSync('psql', [
  ...dbArgs,
  '-A', '-t', '-F', '|',
  '-c', `SELECT migration_name,
              (finished_at IS NOT NULL)::int,
              (rolled_back_at IS NOT NULL)::int
         FROM public."_prisma_migrations"`
], { encoding: 'utf8' }).trim();

const applied = new Set();
const failed = [];

for (const line of migrationRows.split('\n').filter(Boolean)) {
  const [name, finished, rolledBack] = line.split('|');

  if (finished === '1') {
    applied.add(name);
  } else if (rolledBack !== '1') {
    failed.push(name);
  }
}

const pending = [...diskMigrations]
  .filter(name => !applied.has(name));

const missing = [...applied]
  .filter(name => !diskMigrations.has(name));

const expectedPending = [
  '20261102090000_protect_staff_user_identity',
  '20261102091000_runtime_role_permissions',
  '20261102092000_protected_credential_recovery',
  '20261102093000_protected_mfa_login',
];

if (
  failed.length !== 0 ||
  missing.length !== 0 ||
  pending.length !== expectedPending.length ||
  expectedPending.some(name => !pending.includes(name) || applied.has(name))
) {
  stop('Migration history mismatch: ' + JSON.stringify({
    pending, missing, failed
  }));
}

console.log(
  'PASS: Applied migrations verified; reviewed Stage 2 migrations pending.'
);
console.log('Applied:', applied.size);
console.log('Pending:', pending.join(', '));


const testDir = resolve(root, 'server/security/__tests__');
const unitTests = readdirSync(testDir)
  .filter(name => name.endsWith('.test.js'))
  .map(name => 'security/__tests__/' + name);

unitTests.push('middleware/__tests__/auth.test.js');
unitTests.push('__tests__/passwordReset.serviceAtomicity.test.js');
unitTests.push('__tests__/mfaLogin.test.js');
unitTests.push('__tests__/auth.sessionMfaClaim.test.js');

run('Staff security and authentication Jest tests', 'npm', [
  'run', '-w', 'server', 'test', '--',
  '--watchman=false',
  '--coverage=false',
  '--json', '--outputFile=/tmp/chatforia-staff-jest-report.json',
  '--runTestsByPath', ...unitTests
], {
  env: {
    ...process.env,
    TEST_DATABASE_URL: dbUrl
  }
});

run('Real Prisma protected staff integration', 'node', [
  'server/scripts/test-staff-prisma-integration.mjs'
], {
  env: {
    ...process.env,
    TEST_DATABASE_URL: dbUrl
  }
});

run('Permanent PostgreSQL security boundary', 'psql', [
  ...dbArgs,
  '-f', resolve(
    root, 'server/security/db-qa/security-boundary.sql'
  )
]);

function assertion(actor, target, profile, action, secret) {
  return createStaffAuthorizationAssertion({
    actorUserId: actor,
    targetUserId: target,
    targetProfile: profile,
    action,
    tokenVersion: 0,
    mfaVerified: true
  }, { secret });
}

const cases = [
  {
    name: 'Forced audit-failure atomic rollback',
    file: 'audit-rollback.sql',
    env(secret) {
      return {
        QA_SECRET: secret,
        QA_ASSERTION: assertion(
          17, 16, 'SENIOR_ENGINEER',
          'STAFF_ACCESS_GRANT_OR_CHANGE', secret
        )
      };
    }
  },
  {
    name: 'Authorized revocation and audit',
    file: 'valid-revocation.sql',
    env(secret) {
      return {
        QA_SECRET: secret,
        QA_ASSERTION: assertion(
          17, 18, 'SUPPORT',
          'STAFF_ACCESS_REVOKE', secret
        )
      };
    }
  },
  {
    name: 'Repeated and unauthorized revocation',
    file: 'denied-revocations.sql',
    env(secret) {
      return {
        QA_SECRET: secret,
        QA_REPEAT: assertion(
          14, 15, 'SENIOR_ENGINEER',
          'STAFF_ACCESS_REVOKE', secret
        ),
        QA_UNAUTHORIZED: assertion(
          17, 14, 'CTO',
          'STAFF_ACCESS_REVOKE', secret
        )
      };
    }
  }
];

for (const test of cases) {
  const secret = randomBytes(32).toString('hex');
  run(test.name, 'psql', [
    ...dbArgs,
    '-f', resolve(root, 'server/security/db-qa', test.file)
  ], {
    env: {
      ...process.env,
      ...test.env(secret)
    }
  });
}

run('Integrated pending migrations, authentication, recovery and adversarial QA', 'node', [
  'server/scripts/test-staff-integrated.mjs'
], { env: { ...process.env, TEST_DATABASE_URL: dbUrl } });

finish();
console.log('\nPASS: Automated staff security QA completed.');
