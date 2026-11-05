import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PrismaClient } from '@prisma/client';

import { buildPackage, digest } from './migration-package.mjs';
import { aggregateChecks, deployPackage } from './deploy-migration-package.mjs';

// This integration probe accepts only the disposable GitHub service container.
assert.equal(process.env.GITHUB_ACTIONS, 'true');
assert.equal(process.env.GITHUB_EVENT_NAME, 'pull_request');
assert.equal(process.env.GITHUB_REPOSITORY, 'nortonjulian/chatforia');
const container = process.env.CI_POSTGRES18_CONTAINER || '';
assert.match(container, /^[a-f0-9]{12,64}$/);
assert.equal(execFileSync('docker', ['inspect', '--format', '{{.Config.Image}} {{.State.Running}}', container],
  { encoding: 'utf8' }).trim(), 'postgres:18.6 true');
const work = mkdtempSync(join(tmpdir(), 'migration-live-ci-'));
const cert = join(work, 'server.crt');
const key = join(work, 'server.key');
execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1',
  '-keyout', key, '-out', cert, '-subj', '/CN=localhost', '-addext', 'subjectAltName=DNS:localhost,IP:127.0.0.1'], { stdio: 'pipe' });
for (const name of ['server.crt', 'server.key']) execFileSync('docker', ['cp', join(work, name), `${container}:/tmp/${name}`]);
execFileSync('docker', ['exec', '-u', 'root', container, 'sh', '-c', 'chown postgres:postgres /tmp/server.* && chmod 600 /tmp/server.key']);
execFileSync('docker', ['exec', '-i', container, 'psql', '-X', '-v', 'ON_ERROR_STOP=1', '-U', 'chatforia', '-d', 'defaultdb'], {
  input: "ALTER SYSTEM SET ssl='on'; ALTER SYSTEM SET ssl_cert_file='/tmp/server.crt'; ALTER SYSTEM SET ssl_key_file='/tmp/server.key'; SELECT pg_reload_conf(); CREATE DATABASE package_release_test;",
  stdio: ['pipe', 'pipe', 'pipe'],
});
const url = new URL('postgresql://chatforia:qa_password@127.0.0.1:5433/package_release_test');
url.searchParams.set('sslmode', 'require'); url.searchParams.set('sslaccept', 'strict'); url.searchParams.set('sslcert', cert);
process.env.DATABASE_URL = url.toString();
const db = new PrismaClient({ log: [], datasources: { db: { url: url.toString() } } });
try {
  // Model an existing baseline; migrations and data checks run through the actual CLI.
  await db.$executeRawUnsafe('CREATE TABLE public._prisma_migrations (id varchar(36) PRIMARY KEY, checksum varchar(64) NOT NULL, finished_at timestamptz, migration_name varchar(255) NOT NULL, logs text, rolled_back_at timestamptz, started_at timestamptz NOT NULL DEFAULT now(), applied_steps_count integer NOT NULL DEFAULT 0)');
  const repository = join(work, 'repo'); mkdirSync(repository);
  const files = {
    'package-lock.json': readFileSync('package-lock.json'),
    'server/prisma/schema.prisma': 'datasource db {\n provider = "postgresql"\n url = env("DATABASE_URL")\n}\n',
    'server/prisma/migrations/migration_lock.toml': 'provider = "postgresql"\n',
    'server/prisma/migrations/001_fixture/migration.sql': 'CREATE TABLE "PackageFixture" (id integer); INSERT INTO "PackageFixture" VALUES (1);',
    'server/prisma/deployment-checks.json': JSON.stringify({ version: 1,
      migrations: { '001_fixture': { kind: 'data', reason: 'Synthetic fixture only', checks: ['tables'] } },
      checks: { tables: { sql: "SELECT count(*)::text AS total FROM pg_tables WHERE schemaname='public' AND tablename='PackageFixture'",
        rule: 'expected', before: [{ total: '0' }], after: [{ total: '1' }] } } }),
  };
  for (const [path, bytes] of Object.entries(files)) {
    mkdirSync(join(repository, path, '..'), { recursive: true }); writeFileSync(join(repository, path), bytes);
  }
  const git = (...args) => execFileSync('git', args, { cwd: repository, stdio: 'pipe' });
  git('init'); git('config', 'user.name', 'Fixture'); git('config', 'user.email', 'fixture@example.invalid');
  git('add', '.'); git('commit', '-m', 'fixture');
  const bytes = Buffer.from(JSON.stringify(buildPackage('HEAD', repository)));
  const packagePath = join(work, 'package.json'); writeFileSync(packagePath, bytes);
  const archive = join(work, 'archive'); mkdirSync(archive);
  const options = { package: packagePath, sha256: digest(bytes), host: '127.0.0.1', database: 'package_release_test', archive };
  process.env.DATABASE_URL = 'invalid://secret password';
  await assert.rejects(deployPackage(options), (error) => error.message === 'Invalid DATABASE_URL');
  process.env.DATABASE_URL = `${url.toString()}&sslaccept=accept_invalid_certs`;
  await assert.rejects(deployPackage(options), /Duplicate connection parameters/);
  process.env.DATABASE_URL = url.toString();
  await deployPackage(options);
  assert.equal((await db.$queryRawUnsafe('SELECT count(*)::integer AS count FROM _prisma_migrations'))[0].count, 0);
  // A dirty checkout cannot substitute SQL for packaged bytes.
  writeFileSync(join(repository, 'server/prisma/migrations/001_fixture/migration.sql'), 'BROKEN SQL');
  await deployPackage({ ...options, execute: true });
  const receipt = readdirSync(archive).map((name) => JSON.parse(readFileSync(join(archive, name, 'receipt.json'))))
    .find((value) => value.status === 'verified');
  assert.equal(receipt.afterHistory.length, 1);
  assert.equal(receipt.afterChecks.tables[0].total, '1');
  assert.equal((await db.$queryRawUnsafe('SELECT count(*)::integer AS count FROM "PackageFixture"'))[0].count, 1);
  await assert.rejects(aggregateChecks(db, [['write', { sql: 'DELETE FROM "PackageFixture"' }]]));
  assert.equal((await db.$queryRawUnsafe('SELECT count(*)::integer AS count FROM "PackageFixture"'))[0].count, 1);
  await db.$executeRawUnsafe("UPDATE _prisma_migrations SET checksum=repeat('a',64)");
  await assert.rejects(deployPackage({ ...options, execute: true }));
  const receipts = readdirSync(archive).map((name) => JSON.parse(readFileSync(join(archive, name, 'receipt.json'))));
  assert.ok(receipts.some((value) => value.status === 'failed'));
  assert.ok(!JSON.stringify(receipts).includes('qa_password'));
  await assert.rejects(deployPackage({ ...options, host: 'wrong.invalid', execute: true }), /target mismatch/);
  console.log('PASS: strict-TLS preflight, archived SQL execution, aggregate verification, receipts and checksum denial on isolated PG18');
} finally { await db.$disconnect(); rmSync(work, { recursive: true, force: true }); }
