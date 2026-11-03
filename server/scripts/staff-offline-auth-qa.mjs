import { spawnSync } from 'node:child_process';

// These suites inject provider keys, Redis, sessions and database clients.
// No real OAuth identity, provider request or existing database is used.
const isolated = 'postgresql://unused@127.0.0.1:1/staff_offline_auth_test';
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
    '--outputFile=/tmp/chatforia-staff-offline-auth-report.json',
    '--runTestsByPath',
    '__tests__/oauth.routes.test.js',
    '__tests__/oauth.mobileMfa.test.js',
    '__tests__/oauth.tokenVerification.test.js',
    '__tests__/resetTokens.atomic.test.js',
    '__tests__/serializeUser.mfa.test.js',
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
