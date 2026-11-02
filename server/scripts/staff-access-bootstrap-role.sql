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

ALTER ROLE chatforia_staff_owner
  NOLOGIN
  NOINHERIT
  NOSUPERUSER
  NOCREATEDB
  NOCREATEROLE
  NOREPLICATION
  NOBYPASSRLS;

CREATE SCHEMA IF NOT EXISTS staff_security
  AUTHORIZATION chatforia_staff_owner;

ALTER SCHEMA staff_security
  OWNER TO chatforia_staff_owner;

REVOKE ALL ON SCHEMA staff_security FROM PUBLIC;
REVOKE ALL ON SCHEMA staff_security FROM chatforia_dev;

GRANT USAGE ON SCHEMA staff_security TO chatforia_dev;
