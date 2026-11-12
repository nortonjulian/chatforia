import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { renderReleaseUnit } from './systemd-release-unit.mjs';

const oldServer =
  '/var/www/chatforia-api-releases/' + 'a'.repeat(40) + '/app/server';
const newServer =
  '/var/www/chatforia-api-releases/' + 'b'.repeat(40) + '/app/server';
const template = readFileSync(
  'docs/staff-security/chatforia-api-restricted.service.example',
  'utf8'
);
const fixture = template.replaceAll('/var/www/chatforia-api/server', oldServer);

test('release transition changes only the two code paths and preserves the restricted unit', () => {
  const rendered = renderReleaseUnit(fixture, oldServer, newServer);
  assert.equal(
    rendered,
    fixture
      .replace(`WorkingDirectory=${oldServer}`, `WorkingDirectory=${newServer}`)
      .replace(
        `ExecStart=/usr/bin/node ${oldServer}/bootstrap.js`,
        `ExecStart=/usr/bin/node ${newServer}/bootstrap.js`
      )
  );
  assert.equal(renderReleaseUnit(rendered, newServer, oldServer), fixture);
});

test('release transition rejects unexpected paths, duplicate directives and weakened runtime', () => {
  for (const [source, oldPath, newPath] of [
    [fixture, '/var/www/chatforia-api/server', newServer],
    [fixture, oldServer, oldServer],
    [fixture, oldServer, '/tmp/unreviewed/server'],
    [fixture + `WorkingDirectory=${oldServer}\n`, oldServer, newServer],
    [fixture.replace('User=chatforia-api', 'User=root'), oldServer, newServer],
    [
      fixture.replace('Group=chatforia-api', 'Group=root'),
      oldServer,
      newServer,
    ],
    [
      fixture.replace('ProtectHome=true', 'ProtectHome=false'),
      oldServer,
      newServer,
    ],
    [
      fixture.replace(
        'EnvironmentFile=/etc/chatforia/api-runtime.env',
        'EnvironmentFile=/tmp/unreviewed.env'
      ),
      oldServer,
      newServer,
    ],
    [
      fixture.replace(
        'Environment=DOTENV_CONFIG_PATH=/dev/null',
        'Environment=DOTENV_CONFIG_PATH=/var/www/chatforia-api/server/.env'
      ),
      oldServer,
      newServer,
    ],
    [
      fixture.replace(
        `ExecStart=/usr/bin/node ${oldServer}/bootstrap.js`,
        'ExecStart=/usr/bin/npm start'
      ),
      oldServer,
      newServer,
    ],
  ])
    assert.throws(() => renderReleaseUnit(source, oldPath, newPath));
});
