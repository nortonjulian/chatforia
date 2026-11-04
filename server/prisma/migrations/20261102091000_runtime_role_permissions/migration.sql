-- Chatforia runtime role permissions.
-- Applies only AFTER protected identity migration 156.
-- Must be reviewed and tested before staging or production deployment.

DO $role_check$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_roles WHERE rolname = 'chatforia_dev'
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_roles WHERE rolname = 'chatforia_staff_owner'
  ) THEN
    RAISE EXCEPTION 'Required database roles are missing';
  END IF;

  IF pg_has_role(
    'chatforia_dev', 'chatforia_staff_owner', 'MEMBER'
  ) THEN
    RAISE EXCEPTION 'Runtime role must not inherit security owner';
  END IF;
END;
$role_check$;

REVOKE CREATE ON SCHEMA public FROM PUBLIC, chatforia_dev;
GRANT USAGE ON SCHEMA public TO chatforia_dev;
-- Row triggers do not protect TRUNCATE, and attaching a runtime-owned trigger
-- to a security-owner write could execute attacker code with owner authority.
REVOKE TRUNCATE, TRIGGER, REFERENCES ON TABLE
  public."User", public."StaffAssignment", public."StaffAccessEvent",
  public."FounderOwnership", public."AuditLog", public."PasswordResetToken",
  public."VerificationToken", public."TwoFactorRecoveryCode"
FROM PUBLIC, chatforia_dev;

-- Preserve the existing protected staff and audit permissions.
REVOKE INSERT, UPDATE, DELETE ON
  public."StaffAssignment",
  public."StaffAccessEvent",
  public."FounderOwnership"
FROM chatforia_dev;

REVOKE UPDATE, DELETE ON
  public."AuditLog"
FROM chatforia_dev;

GRANT SELECT ON
  public."StaffAssignment",
  public."StaffAccessEvent",
  public."FounderOwnership",
  public."AuditLog"
TO chatforia_dev;

GRANT INSERT ON public."AuditLog" TO chatforia_dev;

-- Normal User operations remain compatible with Prisma.
-- Remove historical table-wide grants before granting individual columns.
REVOKE UPDATE ON public."User" FROM chatforia_dev;
-- Global role and primary-key changes are excluded from direct UPDATE.
-- Migration 156 separately guards protected accounts and ADMIN creation.
GRANT SELECT, INSERT, DELETE
ON public."User" TO chatforia_dev;

DO $user_columns$
DECLARE
  v_columns text;
BEGIN
  SELECT string_agg(format('%I', a.attname), ', ' ORDER BY a.attnum)
  INTO v_columns
  FROM pg_attribute a
  WHERE a.attrelid = 'public."User"'::regclass
    AND a.attnum > 0
    AND NOT a.attisdropped
    AND a.attgenerated = ''
    AND a.attname NOT IN ('id', 'role');

  IF v_columns IS NULL THEN
    RAISE EXCEPTION 'No eligible User update columns found';
  END IF;

  EXECUTE format(
    'GRANT UPDATE (%s) ON public."User" TO chatforia_dev',
    v_columns
  );
END;
$user_columns$;

-- Ordinary application tables and sequences.
-- Deliberately excludes protected tables, migration history, and audits.
DO $ordinary_tables$
DECLARE
  v_table record;
  v_sequence record;
BEGIN
  FOR v_table IN
    SELECT tablename
    FROM pg_tables
    WHERE schemaname = 'public'
      AND tablename NOT IN (
        'User',
        'StaffAssignment',
        'StaffAccessEvent',
        'FounderOwnership',
        'AuditLog',
        '_prisma_migrations'
      )
  LOOP
    EXECUTE format(
      'GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.%I TO chatforia_dev',
      v_table.tablename
    );
  END LOOP;

  FOR v_sequence IN
    SELECT sequencename
    FROM pg_sequences
    WHERE schemaname = 'public'
      AND sequencename NOT IN (
        'StaffAssignment_id_seq',
        'StaffAccessEvent_id_seq'
      )
  LOOP
    EXECUTE format(
      'GRANT USAGE, SELECT ON SEQUENCE public.%I TO chatforia_dev',
      v_sequence.sequencename
    );
  END LOOP;
END;
$ordinary_tables$;



-- Normal authentication retains access to the existing Prisma client.
-- Protected identities cannot have tokens changed by the runtime role.
CREATE FUNCTION staff_security.protect_privileged_auth_token()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, staff_security, pg_temp
AS $function$
DECLARE
  v_old_id INTEGER;
  v_new_id INTEGER;
  v_protected BOOLEAN;
BEGIN
  IF TG_OP <> 'INSERT' THEN
    v_old_id := OLD."userId";
  END IF;

  IF TG_OP <> 'DELETE' THEN
    v_new_id := NEW."userId";
  END IF;

  PERFORM 1
  FROM public."User" u
  WHERE u."id" IN (v_old_id, v_new_id)
  ORDER BY u."id"
  FOR SHARE;

  SELECT EXISTS (
    SELECT 1
    FROM public."User" u
    WHERE u."id" IN (v_old_id, v_new_id)
      AND (
        u."role" = 'ADMIN'
        OR EXISTS (
          SELECT 1 FROM public."FounderOwnership" f
          WHERE f."userId" = u."id"
        )
        OR EXISTS (
          SELECT 1 FROM public."StaffAssignment" s
          WHERE s."userId" = u."id"
        )
      )
  ) INTO v_protected;

  IF v_protected
     AND current_user <> 'chatforia_staff_owner' THEN
    RAISE EXCEPTION
      'Protected account authentication-token change denied'
      USING ERRCODE = '42501';
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;

  RETURN NEW;
END;
$function$;

ALTER FUNCTION staff_security.protect_privileged_auth_token()
OWNER TO chatforia_staff_owner;

REVOKE ALL ON FUNCTION staff_security.protect_privileged_auth_token()
FROM PUBLIC, chatforia_dev;

DO $install$
DECLARE
  v_table TEXT;
BEGIN
  FOREACH v_table IN ARRAY ARRAY[
    'PasswordResetToken',
    'VerificationToken',
    'TwoFactorRecoveryCode'
  ] LOOP
    EXECUTE format(
      'CREATE TRIGGER protect_privileged_auth_token_dml '
      || 'BEFORE INSERT OR UPDATE OR DELETE ON public.%I '
      || 'FOR EACH ROW EXECUTE FUNCTION '
      || 'staff_security.protect_privileged_auth_token()',
      v_table
    );
  END LOOP;
END;
$install$;

GRANT SELECT, INSERT, UPDATE, DELETE ON
  public."PasswordResetToken",
  public."VerificationToken",
  public."TwoFactorRecoveryCode"
TO chatforia_dev, chatforia_staff_owner;

GRANT USAGE, SELECT ON SEQUENCE
  public."PasswordResetToken_id_seq",
  public."VerificationToken_id_seq",
  public."TwoFactorRecoveryCode_id_seq"
TO chatforia_dev, chatforia_staff_owner;

DO $verify_auth$
BEGIN
  IF NOT has_table_privilege(
    'chatforia_dev', 'public."PasswordResetToken"', 'INSERT'
  ) THEN
    RAISE EXCEPTION 'Ordinary password-reset access missing';
  END IF;

  RAISE NOTICE
    'PASS: Authentication token privileges and triggers configured';
END;
$verify_auth$;

-- Final privilege checks.
DO $verify$
BEGIN
  IF has_column_privilege(
      'chatforia_dev', 'public."User"', 'role', 'UPDATE'
    )
    OR has_column_privilege(
      'chatforia_dev', 'public."User"', 'id', 'UPDATE'
    )
    OR has_table_privilege(
      'chatforia_dev', 'public."StaffAssignment"', 'UPDATE'
    )
    OR has_table_privilege(
      'chatforia_dev', 'public."StaffAccessEvent"', 'INSERT'
    )
    OR pg_has_role(
      'chatforia_dev', 'chatforia_staff_owner', 'MEMBER'
    ) THEN
    RAISE EXCEPTION 'Runtime role privilege boundary violated';
  END IF;

  RAISE NOTICE 'PASS: Runtime role permission boundaries verified';
END;
$verify$;
