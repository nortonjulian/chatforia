-- PREPARED ONLY. Requires an approved change window, DBA connection and
-- separately verified baseline migration provenance. Never use app credentials.
-- The no-password LOGIN role must receive credentials through protected custody.
-- Only PostgreSQL's mandatory creator ADMIN memberships may be created.
BEGIN;
DO $$
BEGIN
  IF current_database() <> 'defaultdb'
    OR current_user <> session_user
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

-- A managed cluster may set createrole_self_grant=inherit,set globally.
-- Override it for this transaction only; never change the server setting.
SET LOCAL createrole_self_grant = '';
DO $$
BEGIN
  IF current_setting('createrole_self_grant') <> '' THEN
    RAISE EXCEPTION 'STOP: role self-grant setting was not disabled';
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

DO $verify$
DECLARE
  expected_creator_edges integer;
BEGIN
  SELECT CASE WHEN rolsuper THEN 0 ELSE 4 END INTO expected_creator_edges
    FROM pg_roles WHERE rolname = current_user;
  IF (SELECT count(*) FROM pg_roles WHERE rolname IN
      ('chatforia_dev','chatforia_staff_owner',
       'chatforia_recovery_issuer','chatforia_recovery_executor')
      AND NOT (rolinherit OR rolsuper OR rolcreatedb OR rolcreaterole OR
        rolreplication OR rolbypassrls)
      AND rolcanlogin = (rolname = 'chatforia_dev')) <> 4
     OR (SELECT count(*) FROM pg_auth_members m
       JOIN pg_roles granted ON granted.oid = m.roleid
       JOIN pg_roles member ON member.oid = m.member
       WHERE granted.rolname IN
         ('chatforia_dev','chatforia_staff_owner',
          'chatforia_recovery_issuer','chatforia_recovery_executor')
          OR member.rolname IN
         ('chatforia_dev','chatforia_staff_owner',
          'chatforia_recovery_issuer','chatforia_recovery_executor'))
       <> expected_creator_edges
     OR EXISTS (
       SELECT FROM pg_auth_members m
       JOIN pg_roles granted ON granted.oid = m.roleid
       JOIN pg_roles member ON member.oid = m.member
       WHERE (granted.rolname IN
         ('chatforia_dev','chatforia_staff_owner',
          'chatforia_recovery_issuer','chatforia_recovery_executor')
          OR member.rolname IN
         ('chatforia_dev','chatforia_staff_owner',
          'chatforia_recovery_issuer','chatforia_recovery_executor'))
         AND NOT (expected_creator_edges = 4
           AND granted.rolname IN
             ('chatforia_dev','chatforia_staff_owner',
              'chatforia_recovery_issuer','chatforia_recovery_executor')
           AND member.rolname = current_user
           AND m.grantor = 10::oid
           AND m.admin_option AND NOT m.set_option AND NOT m.inherit_option))
  THEN
    RAISE EXCEPTION 'STOP: base role privileges differ from reviewed plan';
  END IF;
END;
$verify$;
COMMIT;
