-- PREPARED ONLY. Requires an approved change window, DBA connection and
-- separately verified baseline migration provenance. Never use app credentials.
-- The no-password LOGIN role must receive credentials through protected custody.
-- This script creates no memberships, schema, extension or migration entries.
BEGIN;
DO $$
BEGIN
  IF current_database() <> 'defaultdb'
    OR current_user = 'chatforia_dev'
    OR EXISTS (SELECT FROM pg_roles WHERE rolname IN
      ('chatforia_dev', 'chatforia_staff_owner',
       'chatforia_recovery_issuer', 'chatforia_recovery_executor'))
    OR EXISTS (SELECT FROM pg_namespace WHERE nspname = 'staff_security')
  THEN
    RAISE EXCEPTION 'STOP: unexpected production target or pre-existing staff roles/schema';
  END IF;
END
$$;

CREATE ROLE chatforia_dev LOGIN NOINHERIT NOSUPERUSER NOCREATEDB
  NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD NULL;
CREATE ROLE chatforia_staff_owner NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB
  NOCREATEROLE NOREPLICATION NOBYPASSRLS;
CREATE ROLE chatforia_recovery_issuer NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB
  NOCREATEROLE NOREPLICATION NOBYPASSRLS;
CREATE ROLE chatforia_recovery_executor NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB
  NOCREATEROLE NOREPLICATION NOBYPASSRLS;
COMMIT;
