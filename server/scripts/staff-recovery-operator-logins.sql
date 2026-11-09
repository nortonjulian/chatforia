-- PREPARED ONLY. A separately approved DBA action on defaultdb, never CI
-- fixture SQL for an existing database. The sole owner controls two distinct
-- database logins; this is credential/session separation, not two-person approval.
-- Do not add passwords here or put these credentials on the API host.
BEGIN;
DO $guard$
DECLARE
  expected_creator_edges integer;
BEGIN
  -- PostgreSQL 18 automatically grants a non-superuser CREATEROLE executor
  -- ADMIN TRUE, SET FALSE, INHERIT FALSE on each role it creates. The grantor
  -- is the bootstrap superuser (OID 10). A superuser creator gets no such edge.
  SELECT CASE WHEN rolsuper THEN 0 ELSE 2 END INTO expected_creator_edges
    FROM pg_roles WHERE rolname = current_user;
  IF current_database() <> 'defaultdb'
     OR current_user <> session_user
     OR current_user IN ('chatforia_dev', 'chatforia_staff_owner',
       'chatforia_recovery_issuer', 'chatforia_recovery_executor')
     OR EXISTS (SELECT FROM pg_roles WHERE rolname IN
       ('chatforia_recovery_issuer_login', 'chatforia_recovery_executor_login'))
     OR (SELECT count(*) FROM pg_roles WHERE rolname IN
       ('chatforia_recovery_issuer', 'chatforia_recovery_executor')) <> 2
     OR EXISTS (SELECT FROM pg_roles WHERE rolname IN
       ('chatforia_recovery_issuer', 'chatforia_recovery_executor')
       AND (rolcanlogin OR rolinherit OR rolsuper OR rolcreatedb OR
         rolcreaterole OR rolreplication OR rolbypassrls))
     OR (SELECT count(*) FROM pg_auth_members m
       JOIN pg_roles granted ON granted.oid = m.roleid
       JOIN pg_roles member ON member.oid = m.member
       WHERE granted.rolname IN
         ('chatforia_recovery_issuer', 'chatforia_recovery_executor')
          OR member.rolname IN
         ('chatforia_recovery_issuer', 'chatforia_recovery_executor'))
       <> expected_creator_edges
     OR EXISTS (
       SELECT FROM pg_auth_members m
       JOIN pg_roles granted ON granted.oid = m.roleid
       JOIN pg_roles member ON member.oid = m.member
       WHERE (granted.rolname IN
         ('chatforia_recovery_issuer', 'chatforia_recovery_executor')
          OR member.rolname IN
         ('chatforia_recovery_issuer', 'chatforia_recovery_executor'))
         AND NOT (expected_creator_edges = 2
           AND granted.rolname IN
             ('chatforia_recovery_issuer', 'chatforia_recovery_executor')
           AND member.rolname = current_user
           AND m.grantor = 10::oid
           AND m.admin_option AND NOT m.set_option AND NOT m.inherit_option)
     )
     OR pg_has_role('chatforia_dev', 'chatforia_recovery_issuer', 'MEMBER')
     OR pg_has_role('chatforia_dev', 'chatforia_recovery_executor', 'MEMBER')
     OR pg_has_role('chatforia_recovery_issuer', 'chatforia_recovery_executor', 'MEMBER')
     OR pg_has_role('chatforia_recovery_executor', 'chatforia_recovery_issuer', 'MEMBER')
     OR pg_has_role('chatforia_recovery_issuer', 'chatforia_staff_owner', 'MEMBER')
     OR pg_has_role('chatforia_recovery_executor', 'chatforia_staff_owner', 'MEMBER')
  THEN
    RAISE EXCEPTION 'STOP: unexpected recovery target or role graph';
  END IF;
END;
$guard$;

-- The managed cluster sets createrole_self_grant=inherit,set. Keep its
-- automatic self-grants off for these two logins, only within this transaction.
SET LOCAL createrole_self_grant = '';
DO $$
BEGIN
  IF current_setting('createrole_self_grant') <> '' THEN
    RAISE EXCEPTION 'STOP: role self-grant setting was not disabled';
  END IF;
END
$$;

CREATE ROLE chatforia_recovery_issuer_login LOGIN NOINHERIT NOSUPERUSER
  NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD NULL;
CREATE ROLE chatforia_recovery_executor_login LOGIN NOINHERIT NOSUPERUSER
  NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD NULL;

GRANT chatforia_recovery_issuer TO chatforia_recovery_issuer_login
  WITH SET TRUE, INHERIT FALSE, ADMIN FALSE;
GRANT chatforia_recovery_executor TO chatforia_recovery_executor_login
  WITH SET TRUE, INHERIT FALSE, ADMIN FALSE;

DO $verify$
DECLARE
  expected_creator_edges integer;
BEGIN
  SELECT CASE WHEN rolsuper THEN 0 ELSE 2 END INTO expected_creator_edges
    FROM pg_roles WHERE rolname = current_user;
  IF (SELECT count(*) FROM pg_roles WHERE rolname IN
      ('chatforia_recovery_issuer_login', 'chatforia_recovery_executor_login')
      AND rolcanlogin AND NOT (rolinherit OR rolsuper OR rolcreatedb OR
        rolcreaterole OR rolreplication OR rolbypassrls)) <> 2
     OR NOT pg_has_role('chatforia_recovery_issuer_login',
       'chatforia_recovery_issuer', 'SET')
     OR NOT pg_has_role('chatforia_recovery_executor_login',
       'chatforia_recovery_executor', 'SET')
     OR pg_has_role('chatforia_recovery_issuer_login',
       'chatforia_recovery_executor', 'MEMBER')
     OR pg_has_role('chatforia_recovery_executor_login',
       'chatforia_recovery_issuer', 'MEMBER')
     OR pg_has_role('chatforia_recovery_issuer_login',
       'chatforia_staff_owner', 'MEMBER')
     OR pg_has_role('chatforia_recovery_executor_login',
       'chatforia_staff_owner', 'MEMBER')
     OR (SELECT count(*) FROM pg_auth_members m
       JOIN pg_roles member ON member.oid = m.member
       WHERE member.rolname IN
         ('chatforia_recovery_issuer_login', 'chatforia_recovery_executor_login')) <> 2
     OR (SELECT count(*) FROM pg_auth_members m
       JOIN pg_roles granted ON granted.oid = m.roleid
       WHERE granted.rolname IN
         ('chatforia_recovery_issuer_login', 'chatforia_recovery_executor_login'))
       <> expected_creator_edges
     OR EXISTS (
       SELECT FROM pg_auth_members m
       JOIN pg_roles granted ON granted.oid = m.roleid
       JOIN pg_roles member ON member.oid = m.member
       WHERE granted.rolname IN
         ('chatforia_recovery_issuer_login', 'chatforia_recovery_executor_login')
         AND NOT (expected_creator_edges = 2
           AND member.rolname = current_user
           AND m.grantor = 10::oid
           AND m.admin_option AND NOT m.set_option AND NOT m.inherit_option))
     OR (SELECT count(*) FROM pg_auth_members m
       JOIN pg_roles granted ON granted.oid = m.roleid
       JOIN pg_roles member ON member.oid = m.member
       WHERE granted.rolname IN
         ('chatforia_recovery_issuer', 'chatforia_recovery_executor')
          OR member.rolname IN
         ('chatforia_recovery_issuer', 'chatforia_recovery_executor'))
       <> expected_creator_edges + 2
     OR EXISTS (
       SELECT FROM pg_auth_members m
       JOIN pg_roles granted ON granted.oid = m.roleid
       JOIN pg_roles member ON member.oid = m.member
       WHERE (granted.rolname IN
         ('chatforia_recovery_issuer', 'chatforia_recovery_executor')
          OR member.rolname IN
         ('chatforia_recovery_issuer', 'chatforia_recovery_executor'))
         AND NOT (
           (expected_creator_edges = 2
             AND granted.rolname IN
               ('chatforia_recovery_issuer', 'chatforia_recovery_executor')
             AND member.rolname = current_user
             AND m.grantor = 10::oid
             AND m.admin_option AND NOT m.set_option AND NOT m.inherit_option)
           OR (granted.rolname = 'chatforia_recovery_issuer'
             AND member.rolname = 'chatforia_recovery_issuer_login'
             AND NOT m.admin_option AND m.set_option AND NOT m.inherit_option)
           OR (granted.rolname = 'chatforia_recovery_executor'
             AND member.rolname = 'chatforia_recovery_executor_login'
             AND NOT m.admin_option AND m.set_option AND NOT m.inherit_option)))
  THEN
    RAISE EXCEPTION 'STOP: recovery login privileges differ from reviewed plan';
  END IF;
END;
$verify$;
COMMIT;
