-- Prevent previously invalidated sessions from becoming
-- valid again through a decrease in User.tokenVersion.
-- Applies to all database identities performing User updates.

CREATE FUNCTION public.prevent_token_version_rollback()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, pg_temp
AS $function$
BEGIN
  IF NEW."tokenVersion" < OLD."tokenVersion" THEN
    RAISE EXCEPTION
      'Session token version cannot decrease'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION
  public.prevent_token_version_rollback()
FROM PUBLIC;

CREATE TRIGGER prevent_user_token_version_rollback
BEFORE UPDATE OF "tokenVersion"
ON public."User"
FOR EACH ROW
EXECUTE FUNCTION public.prevent_token_version_rollback();
