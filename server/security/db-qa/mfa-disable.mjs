// Standalone disposable PostgreSQL regression. Requires pg (or NODE_PATH).
// Never run against an existing database: this creates its own random test DB.
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
const { Client } = createRequire(import.meta.url)('pg');
const url = process.env.MFA_TEST_ADMIN_URL;
if (!url || !['localhost','127.0.0.1'].includes(new URL(url).hostname)) throw new Error('Explicit loopback MFA_TEST_ADMIN_URL required');
const admin = new Client({ connectionString: url });
await admin.connect();
const name = `mfa_disable_test_${crypto.randomBytes(6).toString('hex')}`;
await admin.query(`CREATE DATABASE ${name}`);
const target = new URL(url); target.pathname = `/${name}`;
const db = new Client({ connectionString: target.href });
await db.connect();
const migration = async (name) => readFile(new URL(`../../prisma/migrations/${name}/migration.sql`, import.meta.url), 'utf8');
const key = 'synthetic-test-secret-32-bytes-long';
try {
  await db.query(`
    DO $$ BEGIN
      IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='chatforia_staff_owner') THEN CREATE ROLE chatforia_staff_owner NOLOGIN; END IF;
      IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='chatforia_dev') THEN CREATE ROLE chatforia_dev NOLOGIN; END IF;
    END $$;
    CREATE SCHEMA staff_security AUTHORIZATION chatforia_staff_owner;
    CREATE EXTENSION pgcrypto WITH SCHEMA staff_security;
    GRANT USAGE ON SCHEMA staff_security TO chatforia_dev;
    CREATE TABLE staff_security.assertion_secrets(id int PRIMARY KEY, verification_secret bytea);
    ALTER TABLE staff_security.assertion_secrets OWNER TO chatforia_staff_owner;
    CREATE TABLE public."User" (
      id int PRIMARY KEY, role text DEFAULT 'USER', "isBanned" boolean DEFAULT false,
      "deletedAt" timestamp, "twoFactorEnabled" boolean DEFAULT true,
      "totpSecretEnc" text DEFAULT 'synthetic-encrypted-secret', "tokenVersion" int DEFAULT 1,
      "twoFactorEnrolledAt" timestamp DEFAULT now(), "passwordHash" text,
      "emailVerifiedAt" timestamp, email text, "emailNorm" text, username text,
      "usernameNorm" text, "googleSub" text, "appleSub" text,
      "isSystem" boolean DEFAULT false, "isTestAccount" boolean DEFAULT false);
    CREATE TABLE public."FounderOwnership"(id int PRIMARY KEY, "userId" int);
    CREATE TABLE public."StaffAssignment"("userId" int PRIMARY KEY, active boolean, "revokedAt" timestamp);
    CREATE TABLE public."VerificationToken"(id serial, "userId" int, type text, "usedAt" timestamp);
    CREATE TABLE public."TwoFactorRecoveryCode"(id serial, "userId" int);
    CREATE TABLE public."PasswordResetToken"(id serial, "userId" int);
    GRANT SELECT ON ALL TABLES IN SCHEMA public TO chatforia_dev, chatforia_staff_owner;
    GRANT UPDATE ON public."User" TO chatforia_dev;
    GRANT UPDATE ("tokenVersion") ON public."User" TO chatforia_staff_owner;
    GRANT UPDATE ON public."VerificationToken" TO chatforia_staff_owner;
    GRANT DELETE ON public."TwoFactorRecoveryCode" TO chatforia_staff_owner;
    INSERT INTO public."User"(id) SELECT generate_series(1,8);
    UPDATE public."User" SET role='ADMIN' WHERE id=4;
    INSERT INTO public."FounderOwnership" VALUES(1,3);
    INSERT INTO public."StaffAssignment" VALUES(1,false,now()),(2,true,NULL);
    INSERT INTO public."VerificationToken"("userId",type) VALUES(1,'mfa_login:0'),(1,'mfax_other'),(1,'mfa_setup');
    INSERT INTO public."TwoFactorRecoveryCode"("userId") VALUES(1);
  `);
  await db.query('INSERT INTO staff_security.assertion_secrets VALUES(1,$1)', [Buffer.from(key)]);
  await db.query(await migration('20261102090000_protect_staff_user_identity'));
  const tokens = await migration('20261102091000_runtime_role_permissions');
  await db.query(tokens.slice(tokens.indexOf('CREATE FUNCTION staff_security.protect_privileged_auth_token()'), tokens.indexOf('$install$;', tokens.indexOf('DO $install$')) + '$install$;'.length));
  await db.query(await migration('20261114050000_authorized_mfa_disable'));
  const claims = (id, extra={}) => ({userId:id, tokenVersion:1, secretHash:crypto.createHash('sha256').update('synthetic-encrypted-secret').digest('hex'), nonce:crypto.randomUUID(), exp:Math.floor(Date.now()/1000)+30, ...extra});
  const call = async (c, signature) => {
    const payload=JSON.stringify(c);
    const sig=signature ?? crypto.createHmac('sha256',key).update(`mfa-disable:${payload}`).digest('hex');
    await db.query('SET ROLE chatforia_dev');
    try { return (await db.query('SELECT staff_security.disable_mfa($1,$2) AS result',[payload,sig])).rows[0].result; }
    finally { await db.query('RESET ROLE'); }
  };
  await db.query('SET ROLE chatforia_dev');
  await assert.rejects(db.query('UPDATE public."User" SET "twoFactorEnabled"=false WHERE id=1'), /authorized security workflow/);
  await db.query('RESET ROLE');
  for (const id of [2,3,4]) assert.equal(await call(claims(id)), 'mfa_required');
  await assert.rejects(call(claims(1), '0'.repeat(64)), /signature/);
  await assert.rejects(call(claims(1,{exp:1})), /claims/);
  await assert.rejects(call(claims(1,{tokenVersion:0})), /session unavailable/);
  await assert.rejects(call(claims(1,{secretHash:'0'.repeat(64)})), /session unavailable/);
  await assert.rejects(call(claims(1,{nonce:null})), /claims/);
  const former = claims(1);
  assert.equal(await call(former), 'disabled');
  await assert.rejects(call(former), /session unavailable/);
  const u=(await db.query('SELECT * FROM public."User" WHERE id=1')).rows[0];
  assert.equal(u.twoFactorEnabled,false); assert.equal(u.totpSecretEnc,null); assert.equal(u.tokenVersion,2);
  assert.equal((await db.query('SELECT count(*)::int AS n FROM public."TwoFactorRecoveryCode" WHERE "userId"=1')).rows[0].n,0);
  const ts=(await db.query('SELECT type,"usedAt" FROM public."VerificationToken" ORDER BY id')).rows;
  assert.ok(ts[0].usedAt); assert.equal(ts[1].usedAt,null); assert.ok(ts[2].usedAt);
  assert.equal((await db.query('SELECT active FROM public."StaffAssignment" WHERE "userId"=1')).rows[0].active,false);
  assert.equal((await db.query('SELECT count(*)::int AS n FROM staff_security.mfa_disable_event')).rows[0].n,1);
  assert.equal(await call(claims(5)), 'disabled');
  // A concurrent staff grant must win before eligibility is evaluated.
  const grant = new Client({ connectionString: target.href });
  await grant.connect();
  try {
    await grant.query('BEGIN');
    await grant.query('SELECT pg_advisory_xact_lock(73421, 1)');
    await grant.query('INSERT INTO public."StaffAssignment" VALUES(7,true,NULL)');
    let completed = false;
    const disabling = call(claims(7)).then((value) => { completed = true; return value; });
    await new Promise((resolve) => setTimeout(resolve, 75));
    assert.equal(completed, false);
    await grant.query('COMMIT');
    assert.equal(await disabling, 'mfa_required');
  } finally { await grant.end(); }
  // Audit failure must roll back the credential update.
  await db.query(`CREATE FUNCTION staff_security.reject_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'audit unavailable'; END $$;
    CREATE TRIGGER reject_audit BEFORE INSERT ON staff_security.mfa_disable_event FOR EACH ROW EXECUTE FUNCTION staff_security.reject_audit();`);
  await assert.rejects(call(claims(6)), /audit unavailable/);
  assert.equal((await db.query('SELECT "twoFactorEnabled" FROM public."User" WHERE id=6')).rows[0].twoFactorEnabled,true);
  console.log('PASS: former/ordinary disable; active/founder/admin denial; direct-write protection; signature, expiry, version, secret, nonce and replay checks; token cleanup; history; atomic audit');
} finally {
  await db.end(); await admin.query(`DROP DATABASE ${name}`); await admin.end();
}
