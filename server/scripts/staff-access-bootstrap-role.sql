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

-- The base-role script required this schema to be absent. A later creator,
-- even one assigning the expected owner, must not turn a pre-existing schema
-- into an accepted preparation result.
CREATE SCHEMA staff_security
  AUTHORIZATION chatforia_staff_owner;

-- A non-superuser DBA with SET membership can create the schema for this
-- owner but cannot exercise its owner-only ACL rights until SET ROLE. Check
-- ownership instead of silently taking over any pre-existing schema.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT FROM pg_namespace n JOIN pg_roles r ON r.oid = n.nspowner
    WHERE n.nspname = 'staff_security'
      AND r.rolname = 'chatforia_staff_owner'
  ) THEN
    RAISE EXCEPTION 'Existing staff_security schema has unexpected owner';
  END IF;
END
$$;

SET ROLE chatforia_staff_owner;

REVOKE ALL ON SCHEMA staff_security FROM PUBLIC;
REVOKE ALL ON SCHEMA staff_security FROM chatforia_dev;

GRANT USAGE ON SCHEMA staff_security TO chatforia_dev;

RESET ROLE;
