\set ON_ERROR_STOP on
-- Fresh disposable postgres:18.6 service only. Never run on an existing DB.
DO $$ BEGIN
  IF current_database() <> 'postgres' OR current_user <> 'postgres'
    OR current_setting('server_version_num')::integer / 10000 <> 18
    OR EXISTS (SELECT FROM pg_database WHERE datname='defaultdb')
    OR EXISTS (SELECT FROM pg_roles WHERE rolname IN
      ('doadmin_probe','chatforia_dev','chatforia_staff_owner'))
  THEN RAISE EXCEPTION 'Not a fresh isolated fixture'; END IF;
END $$;
CREATE ROLE doadmin_probe LOGIN NOSUPERUSER CREATEDB CREATEROLE PASSWORD NULL;
CREATE DATABASE defaultdb OWNER doadmin_probe;
SET SESSION AUTHORIZATION doadmin_probe;
SET createrole_self_grant = '';
CREATE ROLE chatforia_dev LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
CREATE ROLE chatforia_staff_owner NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
CREATE ROLE chatforia_recovery_issuer NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
CREATE ROLE chatforia_recovery_executor NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
GRANT chatforia_staff_owner TO doadmin_probe WITH SET TRUE, INHERIT FALSE, ADMIN FALSE;
\connect defaultdb
SET SESSION AUTHORIZATION doadmin_probe;
CREATE SCHEMA staff_security AUTHORIZATION chatforia_staff_owner;
SET ROLE chatforia_staff_owner;
REVOKE ALL ON SCHEMA staff_security FROM PUBLIC;
GRANT USAGE ON SCHEMA staff_security TO chatforia_dev;
RESET ROLE;
DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_namespace n JOIN pg_roles r ON r.oid=n.nspowner
    WHERE n.nspname='staff_security' AND r.rolname='chatforia_staff_owner')
    OR has_schema_privilege(current_user,'staff_security','USAGE')
    OR has_schema_privilege(current_user,'staff_security','CREATE')
    OR NOT pg_has_role(current_user,'chatforia_staff_owner','SET')
    OR NOT has_schema_privilege('chatforia_dev','staff_security','USAGE')
    OR has_schema_privilege('chatforia_dev','staff_security','CREATE')
  THEN RAISE EXCEPTION 'Synthetic production-equivalent role/ACL mismatch'; END IF;
END $$;
