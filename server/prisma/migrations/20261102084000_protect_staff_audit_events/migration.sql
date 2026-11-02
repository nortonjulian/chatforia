-- Only the dedicated staff security owner may insert
-- reserved staff-access audit records.
-- Ordinary application audit events remain supported.

CREATE FUNCTION public.protect_staff_audit_events()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, pg_temp
AS $function$
BEGIN
  IF (
    left(NEW."action", 6) = 'STAFF_'
    OR NEW."resource" = 'staff_assignment'
  ) AND current_user <> 'chatforia_staff_owner' THEN
    RAISE EXCEPTION
      'Protected staff audit event requires security owner'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION
  public.protect_staff_audit_events()
FROM PUBLIC, chatforia_dev;

CREATE TRIGGER protect_staff_audit_events_insert
BEFORE INSERT ON public."AuditLog"
FOR EACH ROW
EXECUTE FUNCTION public.protect_staff_audit_events();
