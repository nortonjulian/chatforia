import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const workflow = readFileSync('.github/workflows/deploy-backend.yml', 'utf8');
const script = readFileSync('server/scripts/deploy-systemd-api.sh', 'utf8');

test('protected workflow verifies exact current main and package without production connectivity', () => {
  assert.match(workflow, /^on:\n  workflow_dispatch:/m);
  assert.doesNotMatch(workflow, /(^|\n)\s*(push|pull_request|workflow_run|schedule):/);
  assert.match(workflow, /github\.ref == 'refs\/heads\/main'/);
  assert.match(workflow, /production-api/);
  assert.match(workflow, /approved-for-production/);
  assert.match(workflow, /test "\$\(git rev-parse origin\/main\)" = "\$RELEASE_COMMIT"/);
  assert.match(workflow, /test "\$\(git rev-parse HEAD\)" = "\$RELEASE_COMMIT"/);
  assert.match(workflow, /migration-package\.mjs "\$RELEASE_COMMIT"/);
  assert.match(workflow, /sha256sum \/tmp\/chatforia-api-package\.json/);
  assert.match(workflow, /actions\/upload-artifact@v4/);
  assert.match(workflow, /chatforia-api-operator-handoff/);
  assert.doesNotMatch(workflow, /secrets\.|ssh-keyscan|^\s*ssh\s|systemctl|rsync/mi);
  assert.match(workflow, /No production connection or deployment occurred/);
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
  assert.match(script, /test "\$\(git rev-parse origin\/main\)" = "\$commit"/);
  assert.ok(script.lastIndexOf('git fetch --no-tags origin main') > script.indexOf('staff-deployment-preflight.mjs'));
  assert.ok(script.lastIndexOf('test "$(git rev-parse origin/main)" = "$commit"') < script.indexOf('systemctl stop'));
  assert.ok(script.lastIndexOf('test "$(git rev-parse origin/main)" = "$commit"') > script.indexOf('staff-deployment-preflight.mjs'));
  assert.match(script, /npm ci --no-audit --no-fund/);
  assert.match(script, /chatforia-api-releases/);
  assert.match(script, /git worktree add --detach "\$release\/app" "\$commit"/);
  assert.match(script, /npx prisma generate[\s\S]*chgrp -R chatforia-api "\$release\/app"[\s\S]*chmod -R g\+rX "\$release\/app"[\s\S]*application-release-preflight\.mjs/);
  assert.match(script, /for name in uploads tmp_uploads; do[\s\S]*ln -s -- "\$target" "\$new_server\/\$name"/);
  assert.match(script, /systemd-release-unit\.mjs/);
  assert.match(script, /systemctl show -P FragmentPath/);
  assert.match(script, /systemctl show -P DropInPaths/);
  assert.match(script, /cp -- "\$unit_file" "\$release\/previous-unit\.service"/);
  assert.match(script, /cmp -s "\$unit_file" "\$release\/previous-unit\.service"/);
  assert.ok(script.indexOf('systemd-release-unit.mjs') < script.indexOf('systemctl stop'));
  assert.ok(script.indexOf('cmp -s "$unit_file"') < script.indexOf('systemctl stop'));
  assert.ok(script.indexOf('systemctl stop') < script.indexOf('mv -T -- "$next_unit"'));
  assert.match(script, /before_stop=false\nsystemctl stop/);
  assert.match(script, /mv -T -- "\$next_unit" "\$unit_file"\nsystemctl daemon-reload/);
  assert.ok(script.indexOf('mv -T -- "$next_unit"') < script.indexOf('systemctl start'));
  assert.doesNotMatch(script, /chgrp -R chatforia-api "\$checkout\/server"/);
  assert.doesNotMatch(script, /git switch --detach/);
  assert.match(script, /application-release-final-check[\s\S]*staff-runtime-final-check[\s\S]*systemctl start/);
});
