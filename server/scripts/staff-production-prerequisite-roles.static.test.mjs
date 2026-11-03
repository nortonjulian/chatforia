import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

test('prepared role script has target guard, atomic boundary and no privileged grants', () => {
  const sql = readFileSync('server/scripts/staff-production-prerequisite-roles.sql', 'utf8');
  assert.match(sql, /BEGIN;[\s\S]+COMMIT;/);
  assert.match(sql, /current_database\(\) <> 'defaultdb'/);
  for (const name of ['chatforia_dev','chatforia_staff_owner','chatforia_recovery_issuer','chatforia_recovery_executor']) {
    assert.match(sql, new RegExp(`CREATE ROLE ${name} `));
  }
  assert.equal((sql.match(/NOSUPERUSER NOCREATEDB/g) || []).length, 4);
  assert.equal((sql.match(/NOCREATEROLE NOREPLICATION NOBYPASSRLS/g) || []).length, 4);
  assert.match(sql, /chatforia_dev LOGIN NOINHERIT/);
  assert.match(sql, /PASSWORD NULL/);
  assert.doesNotMatch(sql, /^GRANT\s/m);
  assert.doesNotMatch(sql, /(?:migrate resolve|_prisma_migrations)/i);
});
