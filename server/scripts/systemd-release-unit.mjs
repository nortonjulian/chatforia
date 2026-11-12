import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const releaseServer =
  /^\/var\/www\/chatforia-api-releases\/[0-9a-f]{40}\/app\/server$/;

export function renderReleaseUnit(source, oldServer, newServer) {
  if (
    !releaseServer.test(oldServer) ||
    !releaseServer.test(newServer) ||
    oldServer === newServer ||
    !source.endsWith('\n')
  )
    throw new Error('Invalid release unit transition');
  const lines = source.split('\n');
  const required = [
    '[Service]',
    'Type=simple',
    'User=chatforia-api',
    'Group=chatforia-api',
    `WorkingDirectory=${oldServer}`,
    `ExecStart=/usr/bin/node ${oldServer}/bootstrap.js`,
    'EnvironmentFile=/etc/chatforia/api-runtime.env',
    'Restart=on-failure',
    'RestartSec=5s',
    'NoNewPrivileges=true',
    'ProtectHome=true',
    'UMask=0027',
  ];
  if (
    required.some(
      (line) => lines.filter((actual) => actual === line).length !== 1
    ) ||
    lines.filter((line) => line.startsWith('WorkingDirectory=')).length !== 1 ||
    lines.filter((line) => line.startsWith('ExecStart=')).length !== 1 ||
    JSON.stringify(
      lines.filter((line) => line.startsWith('Environment=')).sort()
    ) !==
      JSON.stringify([
        'Environment=DOTENV_CONFIG_PATH=/dev/null',
        'Environment=NODE_ENV=production',
      ])
  )
    throw new Error('Restricted systemd unit differs from reviewed layout');
  return lines
    .map((line) => {
      if (line === `WorkingDirectory=${oldServer}`)
        return `WorkingDirectory=${newServer}`;
      if (line === `ExecStart=/usr/bin/node ${oldServer}/bootstrap.js`)
        return `ExecStart=/usr/bin/node ${newServer}/bootstrap.js`;
      return line;
    })
    .join('\n');
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const [, , unitPath, oldServer, newServer, outputPath] = process.argv;
  if (
    !unitPath ||
    !oldServer ||
    !newServer ||
    !outputPath ||
    process.argv.length !== 6
  )
    throw new Error(
      'Usage: systemd-release-unit.mjs UNIT OLD_SERVER NEW_SERVER OUTPUT'
    );
  const source = readFileSync(unitPath, 'utf8');
  writeFileSync(outputPath, renderReleaseUnit(source, oldServer, newServer), {
    flag: 'wx',
    mode: 0o600,
  });
}
