-- Disposable PostgreSQL 18 service only; never run against an existing database.
BEGIN;
DO $$
BEGIN
  IF current_database() <> 'chatforia_application_release_test'
     OR EXISTS (SELECT FROM pg_tables WHERE schemaname IN ('public', 'staff_security'))
     OR EXISTS (SELECT FROM pg_roles WHERE rolname IN
       ('chatforia_dev','chatforia_staff_owner','chatforia_recovery_issuer',
        'chatforia_recovery_executor')) THEN
    RAISE EXCEPTION 'Application release QA requires a fresh disposable database and roles';
  END IF;
END $$;
CREATE ROLE chatforia_dev LOGIN NOINHERIT NOSUPERUSER NOCREATEDB
  NOCREATEROLE NOREPLICATION NOBYPASSRLS;
CREATE ROLE chatforia_recovery_issuer NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB
  NOCREATEROLE NOREPLICATION NOBYPASSRLS;
CREATE ROLE chatforia_recovery_executor NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB
  NOCREATEROLE NOREPLICATION NOBYPASSRLS;
COMMIT;
