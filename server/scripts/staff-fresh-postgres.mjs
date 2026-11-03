import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import net from 'node:net';

// Fresh-cluster-only helper. Never accepts a caller-supplied database URL,
// existing data directory, role credentials, dump or schema template.
export const artifacts = realpathSync(
  mkdtempSync(join('/tmp', 'chatforia-staff-rehearsal-'))
);
const marker = join(artifacts, 'synthetic-only.json');
writeFileSync(
  marker,
  JSON.stringify({ pid: process.pid, syntheticOnly: true }),
  { mode: 0o600 }
);
const pgBin = process.env.STAFF_QA_PG_BIN || '/usr/local/opt/postgresql@16/bin';
const env = Object.fromEntries(
  Object.entries(process.env).filter(([key]) => !key.startsWith('PG'))
);
env.PGPASSFILE = join(artifacts, 'empty-pgpass');
writeFileSync(env.PGPASSFILE, '', { mode: 0o600 });
export function pg(command, args, input) {
  return execFileSync(join(pgBin, command), args, {
    env,
    encoding: 'utf8',
    input,
    maxBuffer: 16 * 1024 * 1024,
  });
}
async function freePort() {
  const listener = net.createServer();
  await new Promise((resolve, reject) => {
    listener.once('error', reject);
    listener.listen(0, '127.0.0.1', resolve);
  });
  const { port } = listener.address();
  await new Promise((resolve) => listener.close(resolve));
  return port;
}
export async function freshCluster(label) {
  assert.ok(['source', 'restore'].includes(label));
  assert.equal(JSON.parse(readFileSync(marker, 'utf8')).pid, process.pid);
  const directory = join(artifacts, label);
  mkdirSync(directory, { mode: 0o700 });
  const data = join(directory, 'data'),
    socket = join(directory, 'socket');
  mkdirSync(socket, { mode: 0o700 });
  const admin = 'staff_source_admin',
    port = await freePort();
  pg('initdb', [
    '-D',
    data,
    '-U',
    admin,
    '--auth=trust',
    '--no-locale',
    '--encoding=UTF8',
  ]);
  const args = (database) => [
    '-X',
    '-h',
    '127.0.0.1',
    '-p',
    String(port),
    '-U',
    admin,
    '-d',
    database,
    '-v',
    'ON_ERROR_STOP=1',
    '-q',
  ];
  const cluster = {
    label,
    admin,
    port,
    data,
    sql: (database, sql) => pg('psql', args(database), sql),
    url: (database, user = admin) =>
      `postgresql://${user}@127.0.0.1:${port}/${database}`,
    connection: (database) => [
      '-h',
      '127.0.0.1',
      '-p',
      String(port),
      '-U',
      admin,
      '-d',
      database,
    ],
    stop() {
      if (!existsSync(join(data, 'postmaster.pid'))) return;
      assert.equal(JSON.parse(readFileSync(marker, 'utf8')).pid, process.pid);
      assert.equal(
        readFileSync(join(data, 'postmaster.pid'), 'utf8').split('\n')[1],
        data
      );
      pg('pg_ctl', ['-D', data, '-m', 'fast', '-w', 'stop']);
    },
  };
  try {
    pg('pg_ctl', [
      '-D',
      data,
      '-l',
      join(directory, 'postgres.log'),
      '-o',
      `-h 127.0.0.1 -p ${port} -k ${socket} -c timezone=UTC`,
      '-w',
      'start',
    ]);
    const identity = pg('psql', [
      ...args('postgres'),
      '-A',
      '-t',
      '-c',
      "SELECT current_setting('data_directory')",
    ]);
    assert.equal(realpathSync(identity.trim()), realpathSync(data));
    // Only after verifying this exact newly initialized data directory may any
    // role, database or schema be created through this connection.
    return cluster;
  } catch (error) {
    cluster.stop();
    throw error;
  }
}
