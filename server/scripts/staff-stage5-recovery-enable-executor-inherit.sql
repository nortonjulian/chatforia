-- PREPARED ONLY. Production execution needs a separate owner-approved window.
-- Run as doadmin through the exact pinned, TLS-verified defaultdb connection,
-- immediately after the read-only Stage 5 failed-phase recovery preflight.
-- This changes only doadmin's existing membership option. It grants nothing
-- to chatforia_dev and must be reversed after success or failure.
BEGIN;
SET LOCAL statement_timeout = '30s';
DO $$
BEGIN
  IF current_database() <> 'defaultdb' OR current_user <> 'doadmin'
    OR session_user <> 'doadmin'
    OR NOT EXISTS (SELECT FROM pg_namespace n JOIN pg_roles r ON r.oid=n.nspowner
      WHERE n.nspname='staff_security' AND r.rolname='chatforia_staff_owner')
    OR (SELECT count(*) FROM public._prisma_migrations
      WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL) <> 143
    OR (SELECT count(*) FROM public._prisma_migrations
      WHERE rolled_back_at IS NOT NULL) <> 3
    OR (SELECT count(*) FROM public._prisma_migrations
      WHERE finished_at IS NULL AND rolled_back_at IS NULL) <> 1
    OR EXISTS (SELECT FROM pg_stat_activity
      WHERE datname=current_database() AND usename=current_user
        AND pid <> pg_backend_pid() AND backend_type='client backend')
    OR NOT EXISTS (SELECT FROM public._prisma_migrations
      WHERE id='3cba3a9a-c3b5-4d6d-9e1f-28ba5e8016d6'
        AND migration_name='20261102070000_staff_security_foundation'
        AND checksum='717b13a595b54a7c693147f0509caa527637ec3fa81dbc1bd939e6fe4241d662'
        AND finished_at IS NULL AND rolled_back_at IS NULL)
    OR EXISTS (SELECT FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='staff_security' AND c.relkind IN ('r','p','v','m','S'))
    OR EXISTS (SELECT FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname='staff_security')
    OR EXISTS (SELECT FROM public."StaffAssignment")
    OR EXISTS (SELECT FROM public."StaffAccessEvent")
    OR EXISTS (SELECT FROM public."FounderOwnership")
    OR pg_has_role('chatforia_dev','chatforia_staff_owner','MEMBER')
    OR has_schema_privilege('doadmin','staff_security','USAGE')
    OR has_schema_privilege('doadmin','staff_security','CREATE')
    OR (SELECT count(*) FROM pg_auth_members m JOIN pg_roles r ON r.oid=m.roleid
      JOIN pg_roles u ON u.oid=m.member WHERE r.rolname='chatforia_staff_owner'
        AND u.rolname='doadmin') <> 2
    OR NOT EXISTS (SELECT FROM pg_auth_members m JOIN pg_roles r ON r.oid=m.roleid
      JOIN pg_roles u ON u.oid=m.member WHERE r.rolname='chatforia_staff_owner'
        AND u.rolname='doadmin' AND m.grantor=10::oid AND m.admin_option
        AND NOT m.inherit_option AND NOT m.set_option)
    OR NOT EXISTS (SELECT FROM pg_auth_members m JOIN pg_roles r ON r.oid=m.roleid
      JOIN pg_roles u ON u.oid=m.member WHERE r.rolname='chatforia_staff_owner'
        AND u.rolname='doadmin' AND m.grantor=u.oid AND NOT m.admin_option
        AND NOT m.inherit_option AND m.set_option)
  THEN RAISE EXCEPTION 'STOP: Stage 5 recovery target, ledger or privileges differ';
  END IF;
END $$;

GRANT chatforia_staff_owner TO doadmin
  WITH SET TRUE, INHERIT TRUE, ADMIN FALSE;

DO $$
BEGIN
  IF NOT has_schema_privilege('doadmin','staff_security','USAGE')
    OR NOT has_schema_privilege('doadmin','staff_security','CREATE')
    OR pg_has_role('chatforia_dev','chatforia_staff_owner','MEMBER')
    OR (SELECT count(*) FROM pg_auth_members m JOIN pg_roles r ON r.oid=m.roleid
      JOIN pg_roles u ON u.oid=m.member WHERE r.rolname='chatforia_staff_owner'
        AND u.rolname='doadmin') <> 2
    OR NOT EXISTS (SELECT FROM pg_auth_members m JOIN pg_roles r ON r.oid=m.roleid
      JOIN pg_roles u ON u.oid=m.member WHERE r.rolname='chatforia_staff_owner'
        AND u.rolname='doadmin' AND m.grantor=u.oid AND NOT m.admin_option
        AND m.inherit_option AND m.set_option)
  THEN RAISE EXCEPTION 'STOP: temporary executor inheritance did not match plan';
  END IF;
END $$;
COMMIT;
