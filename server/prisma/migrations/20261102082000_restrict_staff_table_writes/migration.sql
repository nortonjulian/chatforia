-- Staff Access: restrict application mutation privileges.
-- Protected SECURITY DEFINER functions remain the authorized
-- entry points for staff assignment and access-history changes.

DO $check$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_roles
    WHERE rolname = 'chatforia_dev' AND rolcanlogin
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_roles
    WHERE rolname = 'chatforia_staff_owner'
      AND NOT rolcanlogin
  ) THEN
    RAISE EXCEPTION 'Required staff security roles unavailable';
  END IF;
END;
$check$;

REVOKE INSERT, UPDATE, DELETE
ON TABLE public."StaffAssignment"
FROM chatforia_dev;

REVOKE INSERT, UPDATE, DELETE
ON TABLE public."StaffAccessEvent"
FROM chatforia_dev;

DO $verify$
BEGIN
  IF has_table_privilege(
    'chatforia_dev', 'public."StaffAssignment"', 'INSERT'
  ) OR has_table_privilege(
    'chatforia_dev', 'public."StaffAssignment"', 'UPDATE'
  ) OR has_table_privilege(
    'chatforia_dev', 'public."StaffAssignment"', 'DELETE'
  ) OR has_table_privilege(
    'chatforia_dev', 'public."StaffAccessEvent"', 'INSERT'
  ) OR has_table_privilege(
    'chatforia_dev', 'public."StaffAccessEvent"', 'UPDATE'
  ) OR has_table_privilege(
    'chatforia_dev', 'public."StaffAccessEvent"', 'DELETE'
  ) THEN
    RAISE EXCEPTION 'Application retains prohibited staff writes';
  END IF;

  IF NOT has_table_privilege(
    'chatforia_staff_owner',
    'public."StaffAssignment"', 'INSERT'
  ) OR NOT has_table_privilege(
    'chatforia_staff_owner',
    'public."StaffAssignment"', 'UPDATE'
  ) OR NOT has_table_privilege(
    'chatforia_staff_owner',
    'public."StaffAccessEvent"', 'INSERT'
  ) THEN
    RAISE EXCEPTION 'Protected security owner lacks required writes';
  END IF;

  IF NOT has_function_privilege(
    'chatforia_dev',
    'staff_security.grant_or_change_staff_access(text,text)',
    'EXECUTE'
  ) OR NOT has_function_privilege(
    'chatforia_dev',
    'staff_security.revoke_staff_access(text,text)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'Protected entry-point execution unavailable';
  END IF;

  RAISE NOTICE 'PASS: Staff write privileges restricted';
  RAISE NOTICE 'PASS: Protected operations remain available';
END;
$verify$;
