import { readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

// Unit/API regression tests use injected database clients. An unreachable local
// URL makes accidental real database access fail rather than touch existing data.
const isolated = 'postgresql://unused@127.0.0.1:1/staff_unit_test';
const tests = readdirSync('server/security/__tests__')
  .filter((name) => name.endsWith('.test.js'))
  .map((name) => `security/__tests__/${name}`);
tests.push(
  'middleware/__tests__/auth.test.js',
  '__tests__/passwordReset.serviceAtomicity.test.js',
  '__tests__/mfaLogin.test.js',
  '__tests__/auth.sessionMfaClaim.test.js'
);
const result = spawnSync(
  'npm',
  [
    'run',
    '-w',
    'server',
    'test',
    '--',
    '--watchman=false',
    '--coverage=false',
    '--json',
    '--outputFile=/tmp/chatforia-staff-unit-report.json',
    '--runTestsByPath',
    ...tests,
  ],
  {
    stdio: 'inherit',
    env: {
      ...process.env,
      NODE_ENV: 'test',
      DATABASE_URL: isolated,
      TEST_DATABASE_URL: isolated,
    },
  }
);
process.exitCode = result.status === 0 && !result.error ? 0 : 1;
