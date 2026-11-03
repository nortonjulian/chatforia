import { spawn } from 'node:child_process';
// Deliberately do not inherit dotenv, database URLs, provider keys or cloud credentials.
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
      STAFF_SHELL_CHECK: process.argv.includes('--helper-check')
        ? 'helper'
        : 'full',
      DOTENV_CONFIG_PATH: '/dev/null',
      JEST_WORKER_ID: 'synthetic-shell',
      STRIPE_SECRET_KEY: 'sk_test_offline_synthetic_only',
      FORCE_HTTPS: 'false',
    },
  }
);
for (const signal of ['SIGINT', 'SIGTERM'])
  process.on(signal, () => child.kill(signal));
child.on('exit', (code) => process.exit(code || 0));
