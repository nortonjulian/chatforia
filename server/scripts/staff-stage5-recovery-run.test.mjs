import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  recoveryConnection,
  runRecoveryChild,
} from './staff-stage5-recovery-run.mjs';

test('psql and Prisma share pinned target; credentials stay out of argv', () => {
  const dir = mkdtempSync(join(tmpdir(), 'recovery-ca-test-'));
  const ca = join(dir, 'ca.pem');
  writeFileSync(ca, 'synthetic CA path validation only');
  const manifest = {
    target: { hostname: 'db.invalid', port: 25060, database: 'defaultdb' },
  };
  const url = new URL(
    'postgresql://doadmin:synthetic@db.invalid:25060/defaultdb'
  );
  url.searchParams.set('sslmode', 'require');
  url.searchParams.set('sslaccept', 'strict');
  url.searchParams.set('sslcert', ca);
  try {
    const env = {
      DATABASE_URL: url.toString(),
      PGOPTIONS: '-c role=wrong',
      PGSERVICE: 'wrong',
    };
    const result = recoveryConnection(env, manifest);
    assert.equal(result.psqlEnv.PGSSLMODE, 'verify-full');
    assert.equal(result.psqlEnv.PGSSLROOTCERT, ca);
    assert.equal(result.psqlEnv.PGOPTIONS, undefined);
    assert.equal(result.psqlEnv.PGSERVICE, undefined);
    for (const [key, value] of [
      ['schema', 'other'],
      ['host', 'other'],
      ['sslmode', 'disable'],
      ['sslaccept', 'accept_invalid_certs'],
      ['sslrootcert', '/different.pem'],
    ]) {
      const altered = new URL(url);
      altered.searchParams.set(key, value);
      assert.throws(() =>
        recoveryConnection({ DATABASE_URL: altered.toString() }, manifest)
      );
    }
    assert.throws(() =>
      recoveryConnection({ ...env, DIRECT_URL: 'other' }, manifest)
    );
    assert.throws(() =>
      recoveryConnection(
        { ...env, DATABASE_URL: `${url}&sslmode=require` },
        manifest
      )
    );
    for (const [property, value] of [
      ['hostname', 'other.invalid'],
      ['port', '5432'],
      ['pathname', '/other'],
      ['username', 'chatforia_dev'],
    ]) {
      const altered = new URL(url);
      altered[property] = value;
      assert.throws(() =>
        recoveryConnection({ DATABASE_URL: altered.toString() }, manifest)
      );
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('child failures and timeout are awaited and do not leak diagnostics', async () => {
  await runRecoveryChild(process.execPath, ['-e', 'process.exit(0)'], {
    timeout: 2000,
  });
  await assert.rejects(
    runRecoveryChild(
      process.execPath,
      ['-e', 'console.error("private diagnostic"); process.exit(1)'],
      { timeout: 2000 }
    ),
    /Child failed or timed out/
  );
  await assert.rejects(
    runRecoveryChild(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
      timeout: 50,
    }),
    /Child failed or timed out/
  );
  await assert.rejects(
    runRecoveryChild('/nonexistent/stage5-executable', [], { timeout: 2000 }),
    /Child failed to start/
  );
});
