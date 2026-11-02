-- Chatforia Staff Access: protect security-critical fields of founder/staff users.
-- This migration is intentionally separate from ordinary runtime GRANTs.
-- Important: staff/founder credential and MFA changes require a future
-- independently-authorized path before deploying this restriction to staging.

CREATE FUNCTION staff_security.protect_staff_user_identity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, staff_security, pg_temp
AS $function$
DECLARE
  v_user_id integer;
  v_protected boolean;
BEGIN
  -- New accounts cannot receive global administrator
  -- authority through an ordinary INSERT.
  IF TG_OP = 'INSERT' THEN
    IF NEW."role" = 'ADMIN' THEN
      RAISE EXCEPTION
        'Global administrator creation requires authorized bootstrap'
        USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;

  v_user_id := OLD."id";

  IF TG_OP = 'UPDATE'
     AND NEW."id" IS DISTINCT FROM OLD."id" THEN
    RAISE EXCEPTION 'Direct user identity changes are prohibited'
      USING ERRCODE = '42501';
  END IF;

  SELECT
    EXISTS (
      SELECT 1 FROM public."FounderOwnership" fo
      WHERE fo."id" = 1 AND fo."userId" = v_user_id
    ) OR EXISTS (
      SELECT 1 FROM public."StaffAssignment" sa
      WHERE sa."userId" = v_user_id
    )
  INTO v_protected;

  -- Existing global administrators receive the same
  -- identity protections as founder and staff accounts.
  v_protected := v_protected OR OLD."role" = 'ADMIN';

  IF NOT v_protected THEN
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;

  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Protected staff or founder account cannot be deleted directly'
      USING ERRCODE = '42501';
  END IF;

  -- Credential changes require the protected function owner.
  -- With SECURITY INVOKER, current_user is the actual
  -- executing database role, not automatically the trigger owner.
  IF NEW."passwordHash" IS DISTINCT FROM OLD."passwordHash"
     OR NEW."twoFactorEnabled" IS DISTINCT FROM OLD."twoFactorEnabled"
     OR NEW."totpSecretEnc" IS DISTINCT FROM OLD."totpSecretEnc"
     OR NEW."twoFactorEnrolledAt" IS DISTINCT FROM OLD."twoFactorEnrolledAt"
  THEN
    IF current_user <> 'chatforia_staff_owner' THEN
      RAISE EXCEPTION
        'Protected credentials require authorized security workflow'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  IF NEW."id" IS DISTINCT FROM OLD."id"
     OR NEW."role" IS DISTINCT FROM OLD."role"
     OR NEW."emailVerifiedAt" IS DISTINCT FROM OLD."emailVerifiedAt"
     OR NEW."email" IS DISTINCT FROM OLD."email"
     OR NEW."emailNorm" IS DISTINCT FROM OLD."emailNorm"
     OR NEW."username" IS DISTINCT FROM OLD."username"
     OR NEW."usernameNorm" IS DISTINCT FROM OLD."usernameNorm"
     OR NEW."googleSub" IS DISTINCT FROM OLD."googleSub"
     OR NEW."appleSub" IS DISTINCT FROM OLD."appleSub"
     OR NEW."isSystem" IS DISTINCT FROM OLD."isSystem"
     OR NEW."isTestAccount" IS DISTINCT FROM OLD."isTestAccount"
     OR NEW."isBanned" IS DISTINCT FROM OLD."isBanned"
     OR NEW."deletedAt" IS DISTINCT FROM OLD."deletedAt" THEN
    RAISE EXCEPTION 'Protected staff or founder identity change requires authorized security workflow'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$function$;

ALTER FUNCTION staff_security.protect_staff_user_identity()
  OWNER TO chatforia_staff_owner;

REVOKE ALL ON FUNCTION staff_security.protect_staff_user_identity()
  FROM PUBLIC, chatforia_dev;

-- Security-owner credential writes are reserved for narrowly scoped,
-- audited SECURITY DEFINER functions installed separately.
-- The application runtime role receives none of these privileges.
GRANT UPDATE (
  "passwordHash",
  "twoFactorEnabled",
  "totpSecretEnc",
  "twoFactorEnrolledAt"
) ON TABLE public."User" TO chatforia_staff_owner;

CREATE TRIGGER protect_staff_user_identity_insert
BEFORE INSERT ON public."User"
FOR EACH ROW
EXECUTE FUNCTION staff_security.protect_staff_user_identity();

CREATE TRIGGER protect_staff_user_identity_update
BEFORE UPDATE ON public."User"
FOR EACH ROW
EXECUTE FUNCTION staff_security.protect_staff_user_identity();

CREATE TRIGGER protect_staff_user_identity_delete
BEFORE DELETE ON public."User"
FOR EACH ROW
EXECUTE FUNCTION staff_security.protect_staff_user_identity();
