-- Disposable CI prerequisites only. Run before migrations through the new
-- GitHub Actions PostgreSQL service container, never an application connection.
-- The existing staff-access-bootstrap-role.sql installs the restricted owner
-- and schema immediately after this file. Production bootstrap is separate.
BEGIN;
DO $$
BEGIN
  IF current_database() <> 'chatforia_room_settings_test'
     OR EXISTS (SELECT FROM pg_tables WHERE schemaname IN ('public', 'staff_security'))
     OR EXISTS (SELECT FROM pg_roles WHERE rolname IN (
       'chatforia_dev', 'chatforia_staff_owner',
       'chatforia_recovery_issuer', 'chatforia_recovery_executor'
     )) THEN
    RAISE EXCEPTION 'CI bootstrap requires a new empty dedicated database and fresh roles';
  END IF;
END
$$;

CREATE ROLE chatforia_dev LOGIN NOINHERIT NOSUPERUSER NOCREATEDB
  NOCREATEROLE NOREPLICATION NOBYPASSRLS;
CREATE ROLE chatforia_recovery_issuer NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB
  NOCREATEROLE NOREPLICATION NOBYPASSRLS;
CREATE ROLE chatforia_recovery_executor NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB
  NOCREATEROLE NOREPLICATION NOBYPASSRLS;
-- No passwords, privileged memberships, ownership or broad grants. Migrations
-- provide the explicitly reviewed runtime table/column/function permissions.
COMMIT;
