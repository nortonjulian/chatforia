import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

// Explicitly opt in to a disposable, network-isolated PostgreSQL 18 container.
// This script never accepts a database URL or contacts an existing database.
const name = process.env.STAFF_PG18_ROLE_CONTAINER || '';
assert.match(name, /^chatforia-pg18-role-test-[0-9]{8}$/);
const [container] = JSON.parse(execFileSync('docker', ['inspect', name], { encoding: 'utf8' }));
assert.equal(container.Config.Image, 'postgres:18.6');
assert.equal(container.State.Running, true);
assert.equal(container.HostConfig.NetworkMode, 'none');
assert.equal(container.Mounts.length, 1);
assert.equal(container.Mounts[0].Type, 'volume');
assert.match(container.Mounts[0].Name, /^[a-f0-9]{64}$/);
assert.equal(container.Mounts[0].Destination, '/var/lib/postgresql');
assert.ok(container.Config.Cmd.includes('createrole_self_grant=inherit,set'));

const sql = (user, database, script) => execFileSync('docker', [
  'exec', '-i', name, 'psql', '-X', '-A', '-t', '-q', '-v', 'ON_ERROR_STOP=1',
  '-U', user, '-d', database,
], { input: script, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();

assert.equal(sql('postgres', 'postgres', 'SHOW createrole_self_grant'), 'inherit,set');
sql('postgres', 'postgres', `CREATE ROLE doadmin LOGIN INHERIT CREATEROLE CREATEDB
  REPLICATION BYPASSRLS`);
sql('postgres', 'postgres', 'CREATE DATABASE defaultdb OWNER doadmin');
assert.equal(sql('doadmin', 'defaultdb', 'SELECT current_user'), 'doadmin');

// Reproduce the two distinct grants observed on the managed target.
sql('doadmin', 'defaultdb', 'CREATE ROLE chatforia_probe NOLOGIN NOINHERIT');
assert.equal(sql('doadmin', 'defaultdb', `SELECT count(*) = 2 AND
  bool_or(m.grantor = 10::oid AND m.admin_option AND
    NOT m.set_option AND NOT m.inherit_option) AND
  bool_or(grantor.rolname = 'doadmin' AND NOT m.admin_option AND
    m.set_option AND m.inherit_option)
  FROM pg_auth_members m JOIN pg_roles granted ON granted.oid=m.roleid
  JOIN pg_roles grantor ON grantor.oid=m.grantor
  WHERE granted.rolname='chatforia_probe'`), 't');
assert.equal(sql('doadmin', 'defaultdb', `SELECT
  pg_has_role('doadmin','chatforia_probe','SET') AND
  pg_has_role('doadmin','chatforia_probe','USAGE')`), 't');
assert.equal(sql('doadmin', 'defaultdb',
  'SET ROLE chatforia_probe; SELECT current_user'), 'chatforia_probe');
sql('doadmin', 'defaultdb', 'DROP ROLE chatforia_probe');
console.log('PASS: configured self-grant reproduces the observed SET and INHERIT edges');

const base = readFileSync('server/scripts/staff-production-prerequisite-roles.sql', 'utf8');
assert.throws(() => sql('doadmin', 'defaultdb',
  base.replace("SET LOCAL createrole_self_grant = '';", '')));
assert.equal(sql('doadmin', 'defaultdb', `SELECT count(*) FROM pg_roles
  WHERE rolname IN ('chatforia_dev','chatforia_staff_owner',
    'chatforia_recovery_issuer','chatforia_recovery_executor')`), '0');
assert.throws(() => sql('doadmin', 'defaultdb', base.replace('DO $verify$',
  `GRANT chatforia_dev TO doadmin WITH SET TRUE, INHERIT TRUE, ADMIN FALSE;
DO $verify$`)));
assert.equal(sql('doadmin', 'defaultdb', `SELECT count(*) FROM pg_roles
  WHERE rolname IN ('chatforia_dev','chatforia_staff_owner',
    'chatforia_recovery_issuer','chatforia_recovery_executor')`), '0');
sql('doadmin', 'defaultdb', base);
assert.equal(sql('doadmin', 'defaultdb', `SELECT count(*) = 4 AND
  bool_and(m.grantor=10::oid AND m.admin_option AND
    NOT m.set_option AND NOT m.inherit_option)
  FROM pg_auth_members m JOIN pg_roles granted ON granted.oid=m.roleid
  WHERE granted.rolname IN ('chatforia_dev','chatforia_staff_owner',
    'chatforia_recovery_issuer','chatforia_recovery_executor')`), 't');
assert.equal(sql('doadmin', 'defaultdb', `SELECT NOT
  pg_has_role('doadmin','chatforia_staff_owner','SET') AND NOT
  pg_has_role('doadmin','chatforia_staff_owner','USAGE') AND NOT
  pg_has_role('doadmin','chatforia_dev','SET')`), 't');
assert.throws(() => sql('doadmin', 'defaultdb', 'SET ROLE chatforia_staff_owner'));
assert.equal(sql('doadmin', 'defaultdb', 'SHOW createrole_self_grant'), 'inherit,set');
console.log('PASS: corrected base-role transaction leaves only four ADMIN edges and restores session setting');

const recovery = readFileSync('server/scripts/staff-recovery-operator-logins.sql', 'utf8');
sql('doadmin', 'defaultdb', `GRANT chatforia_recovery_executor TO chatforia_recovery_issuer
  WITH SET TRUE, INHERIT FALSE, ADMIN FALSE`);
assert.throws(() => sql('doadmin', 'defaultdb', recovery));
assert.equal(sql('doadmin', 'defaultdb', `SELECT count(*) FROM pg_roles WHERE rolname IN
  ('chatforia_recovery_issuer_login','chatforia_recovery_executor_login')`), '0');
sql('doadmin', 'defaultdb', 'REVOKE chatforia_recovery_executor FROM chatforia_recovery_issuer');
assert.throws(() => sql('doadmin', 'defaultdb', recovery.replace('DO $verify$',
  `GRANT chatforia_recovery_issuer_login TO doadmin
    WITH SET TRUE, INHERIT TRUE, ADMIN FALSE;
DO $verify$`)));
assert.equal(sql('doadmin', 'defaultdb', `SELECT count(*) FROM pg_roles WHERE rolname IN
  ('chatforia_recovery_issuer_login','chatforia_recovery_executor_login')`), '0');
sql('doadmin', 'defaultdb', recovery);
assert.equal(sql('doadmin', 'defaultdb', `SELECT count(*) = 2 AND
  bool_and(m.grantor=10::oid AND m.admin_option AND
    NOT m.set_option AND NOT m.inherit_option)
  FROM pg_auth_members m JOIN pg_roles granted ON granted.oid=m.roleid
  WHERE granted.rolname IN
    ('chatforia_recovery_issuer_login','chatforia_recovery_executor_login')`), 't');
assert.equal(sql('doadmin', 'defaultdb', `SELECT NOT
  pg_has_role('doadmin','chatforia_recovery_issuer_login','SET') AND NOT
  pg_has_role('doadmin','chatforia_recovery_executor_login','USAGE')`), 't');
assert.equal(sql('postgres', 'defaultdb', `SET SESSION AUTHORIZATION
  chatforia_recovery_issuer_login; SET ROLE chatforia_recovery_issuer;
  SELECT current_user`), 'chatforia_recovery_issuer');
assert.throws(() => sql('postgres', 'defaultdb', `SET SESSION AUTHORIZATION
  chatforia_recovery_issuer_login; SET ROLE chatforia_recovery_executor`));
assert.throws(() => sql('postgres', 'defaultdb', `SET SESSION AUTHORIZATION
  chatforia_dev; SET ROLE chatforia_staff_owner`));
assert.equal(sql('doadmin', 'defaultdb', 'SHOW createrole_self_grant'), 'inherit,set');
console.log('PASS: recovery logins retain exclusive SET grants and runtime role remains denied');
