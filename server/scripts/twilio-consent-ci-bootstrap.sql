-- Run only inside the disposable Twilio consent GitHub Actions service.
BEGIN;
DO $$
BEGIN
  IF current_database() <> 'chatforia_twilio_consent_test'
     OR current_user <> 'consent_ci'
     OR EXISTS (SELECT FROM pg_tables WHERE schemaname IN ('public', 'staff_security'))
     OR EXISTS (SELECT FROM pg_roles WHERE rolname IN (
       'chatforia_dev', 'chatforia_staff_owner',
       'chatforia_recovery_issuer', 'chatforia_recovery_executor'
     )) THEN
    RAISE EXCEPTION 'Twilio consent CI bootstrap requires a new dedicated database';
  END IF;
END
$$;

CREATE ROLE chatforia_dev LOGIN NOINHERIT NOSUPERUSER NOCREATEDB
  NOCREATEROLE NOREPLICATION NOBYPASSRLS;
CREATE ROLE chatforia_recovery_issuer NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB
  NOCREATEROLE NOREPLICATION NOBYPASSRLS;
CREATE ROLE chatforia_recovery_executor NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB
  NOCREATEROLE NOREPLICATION NOBYPASSRLS;
COMMIT;
