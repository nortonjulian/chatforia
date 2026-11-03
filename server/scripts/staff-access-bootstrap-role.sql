-- Run only through an explicitly authorized database administrator.
-- Never execute using the normal Chatforia application connection.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_roles
    WHERE rolname = 'chatforia_staff_owner'
  ) THEN
    CREATE ROLE chatforia_staff_owner
      NOLOGIN
      NOINHERIT
      NOSUPERUSER
      NOCREATEDB
      NOCREATEROLE
      NOREPLICATION
      NOBYPASSRLS;
  END IF;
END
$$;

-- Fail closed on a pre-existing unsafe role rather than silently rewriting it.
-- Even ALTER ROLE ... NOSUPERUSER requires a real superuser on PostgreSQL;
-- managed-service administrators cannot execute that unnecessary normalization.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT FROM pg_roles WHERE rolname = 'chatforia_staff_owner'
      AND NOT (rolcanlogin OR rolinherit OR rolsuper OR rolcreatedb
        OR rolcreaterole OR rolreplication OR rolbypassrls)
  ) THEN
    RAISE EXCEPTION 'Existing staff security owner role is unsafe';
  END IF;
END
$$;

CREATE SCHEMA IF NOT EXISTS staff_security
  AUTHORIZATION chatforia_staff_owner;

ALTER SCHEMA staff_security
  OWNER TO chatforia_staff_owner;

REVOKE ALL ON SCHEMA staff_security FROM PUBLIC;
REVOKE ALL ON SCHEMA staff_security FROM chatforia_dev;

GRANT USAGE ON SCHEMA staff_security TO chatforia_dev;
