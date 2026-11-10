-- PREPARED ONLY. Run after the migration attempt, even if it fails.
-- Do not require 161/4/0: cleanup must work for any partial migration ledger.
-- Idempotent: the existing self-granted edge may already have INHERIT FALSE.
-- Execute with psql ON_ERROR_STOP; never wrap this file in an outer transaction.
BEGIN;
SET statement_timeout = '30s';
DO $$
BEGIN
  IF current_database() <> 'defaultdb' OR current_user <> 'doadmin'
    OR session_user <> 'doadmin'
    OR NOT EXISTS (SELECT FROM pg_auth_members m JOIN pg_roles r ON r.oid=m.roleid
      JOIN pg_roles u ON u.oid=m.member WHERE r.rolname='chatforia_staff_owner'
        AND u.rolname='doadmin' AND m.grantor=u.oid)
  THEN RAISE EXCEPTION 'STOP: cleanup identity or existing owner edge differs';
  END IF;
END $$;

GRANT chatforia_staff_owner TO doadmin
  WITH INHERIT FALSE;

-- Commit privilege reduction BEFORE checking unrelated invariants.
-- A later diagnostic failure must never restore temporary inheritance.
COMMIT;

DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_namespace n JOIN pg_roles r ON r.oid=n.nspowner
      WHERE n.nspname='staff_security' AND r.rolname='chatforia_staff_owner')
    OR NOT EXISTS (SELECT FROM pg_auth_members m JOIN pg_roles r ON r.oid=m.roleid
      JOIN pg_roles u ON u.oid=m.member WHERE r.rolname='chatforia_staff_owner'
        AND u.rolname='doadmin' AND m.grantor=10::oid AND m.admin_option
        AND NOT m.inherit_option AND NOT m.set_option)
    OR has_schema_privilege('doadmin','staff_security','USAGE')
    OR has_schema_privilege('doadmin','staff_security','CREATE')
    OR pg_has_role('chatforia_dev','chatforia_staff_owner','MEMBER')
    OR (SELECT count(*) FROM pg_auth_members m JOIN pg_roles r ON r.oid=m.roleid
      JOIN pg_roles u ON u.oid=m.member WHERE r.rolname='chatforia_staff_owner'
        AND u.rolname='doadmin') <> 2
    OR NOT EXISTS (SELECT FROM pg_auth_members m JOIN pg_roles r ON r.oid=m.roleid
      JOIN pg_roles u ON u.oid=m.member WHERE r.rolname='chatforia_staff_owner'
        AND u.rolname='doadmin' AND m.grantor=u.oid AND NOT m.admin_option
        AND NOT m.inherit_option AND m.set_option)
  THEN RAISE EXCEPTION 'STOP: executor inheritance was not fully restored';
  END IF;
END $$;
