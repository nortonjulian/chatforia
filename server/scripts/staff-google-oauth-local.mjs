import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
const metadata = JSON.parse(
  readFileSync('/tmp/chatforia-redis-build.json', 'utf8')
);
const child = spawn(
  process.execPath,
  ['server/scripts/staff-shell-server.mjs'],
  {
    stdio: 'inherit',
    env: {
      PATH: process.env.PATH,
      LC_ALL: 'C',
      LANG: 'C',
      NODE_ENV: 'development',
      DOTENV_CONFIG_PATH: '/dev/null',
      STAFF_GOOGLE_OAUTH: 'isolated-synthetic-only',
      STAFF_GOOGLE_CREDENTIAL_FILE: `/private/tmp/chatforia-dev-oauth-${process.getuid()}/dev-client.json`,
      STAFF_QA_REDIS_BIN: metadata.binary,
      STRIPE_SECRET_KEY: 'sk_test_offline_synthetic_only',
      FORCE_HTTPS: 'false',
      LOG_LEVEL: 'silent',
    },
  }
);
for (const signal of ['SIGINT', 'SIGTERM'])
  process.on(signal, () => child.kill(signal));
child.on('exit', (code) => process.exit(code || 0));
