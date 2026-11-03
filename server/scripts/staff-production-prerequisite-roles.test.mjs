import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { freshCluster } from './staff-fresh-postgres.mjs';

test('prepared production role SQL is scoped, restricted and atomic on a fresh synthetic cluster', async () => {
  const cluster = await freshCluster('source');
  const sql = readFileSync('server/scripts/staff-production-prerequisite-roles.sql', 'utf8');
  try {
    assert.throws(() => cluster.sql('postgres', sql), /unexpected production target/);
    cluster.sql('postgres', 'CREATE DATABASE defaultdb');
    assert.match(cluster.sql('postgres', `SELECT count(*) FROM pg_roles WHERE rolname LIKE 'chatforia_%'`), /\n\s*0\s*\n/);
    cluster.sql('defaultdb', sql);
    const attributes = cluster.sql('defaultdb', `
      SELECT count(*)=4 AND bool_and(rolinherit = false AND rolsuper = false
        AND rolcreatedb = false AND rolcreaterole = false AND
        rolreplication = false AND rolbypassrls = false AND
        rolcanlogin = (rolname = 'chatforia_dev')) AS restricted
      FROM pg_roles WHERE rolname IN
        ('chatforia_dev','chatforia_staff_owner','chatforia_recovery_issuer','chatforia_recovery_executor')`);
    assert.match(attributes, /\n\s*t\s*\n/);
    assert.throws(() => cluster.sql('defaultdb', sql), /pre-existing staff roles/);
  } finally {
    cluster.stop();
  }
});
