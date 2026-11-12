import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const workflow = readFileSync('.github/workflows/deploy-backend.yml', 'utf8');
const script = readFileSync('server/scripts/deploy-systemd-api.sh', 'utf8');

test('backend workflow remains manual, SHA-bound, and cannot invoke legacy PM2/migrations', () => {
  assert.match(workflow, /^on:\n  workflow_dispatch:/m);
  assert.doesNotMatch(workflow, /(^|\n)\s*(push|pull_request|workflow_run|schedule):/);
  assert.match(workflow, /github\.ref == 'refs\/heads\/main'/);
  assert.match(workflow, /production-api/);
  assert.match(workflow, /approved-for-production/);
  assert.match(workflow, /API_DO_SSH_KNOWN_HOSTS/);
  assert.match(workflow, /StrictHostKeyChecking=yes/);
  assert.doesNotMatch(workflow, /ssh-keyscan/);
  for (const forbidden of [/prisma migrate/, /pm2 reload/, /git reset/, /git clean/])
    assert.doesNotMatch(workflow + script, forbidden);
  assert.doesNotMatch(script, /DATABASE_URL=/);
});

test('restricted schema and staff preflights precede stopping the systemd API', () => {
  execFileSync('bash', ['-n', 'server/scripts/deploy-systemd-api.sh']);
  assert.match(script, /systemctl show -P User.*chatforia-api/);
  assert.match(script, /test "\$\(id -u\)" -eq 0/);
  assert.match(script, /systemctl show -P Group.*chatforia-api/);
  assert.match(script, /EnvironmentFile=\/etc\/chatforia\/api-runtime\.env/);
  assert.match(script, /-E NODE_ENV=production -E DOTENV_CONFIG_PATH=\/dev\/null/);
  assert.match(script, /DOTENV_CONFIG_\(PATH\|OVERRIDE\)/);
  assert.ok(script.indexOf('application-release-preflight.mjs') < script.indexOf('systemctl stop'));
  assert.ok(script.indexOf('staff-deployment-preflight.mjs') < script.indexOf('systemctl stop'));
  assert.ok(script.indexOf('systemctl stop') < script.indexOf('systemctl start'));
  assert.match(script, /git merge-base --is-ancestor "\$commit" origin\/main/);
  assert.match(script, /npm ci --no-audit --no-fund/);
  assert.match(script, /npx prisma generate[\s\S]*chgrp -R chatforia-api "\$stage\/source"[\s\S]*chmod -R g\+rX "\$stage\/source"[\s\S]*application-release-preflight\.mjs/);
  assert.match(script, /git ls-files -z -- server/);
  assert.match(script, /server\/uploads\/\*\|server\/tmp_uploads\/\*\) continue/);
  assert.doesNotMatch(script, /chgrp -R chatforia-api "\$checkout\/server"/);
  assert.match(script, /chgrp -R chatforia-api "\$checkout\/node_modules"[\s\S]*application-release-final-check[\s\S]*staff-runtime-final-check[\s\S]*systemctl start/);
});
