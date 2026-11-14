-- Self-service disable after application TOTP verification. Historical staff
-- identity protection remains intact; this is not a general credential writer.
CREATE TABLE staff_security.mfa_disable_event (
  nonce uuid PRIMARY KEY,
  user_id integer NOT NULL,
  previous_token_version integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE staff_security.mfa_disable_event OWNER TO chatforia_staff_owner;
REVOKE ALL ON staff_security.mfa_disable_event FROM PUBLIC, chatforia_dev;

CREATE FUNCTION staff_security.disable_mfa(p_payload text, p_signature text)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, staff_security, pg_temp
AS $fn$
DECLARE
  c jsonb;
  u public."User"%ROWTYPE;
  k bytea;
BEGIN
  SELECT verification_secret INTO STRICT k FROM staff_security.assertion_secrets WHERE id = 1;
  IF p_payload IS NULL OR length(p_payload) > 4096 OR p_signature IS NULL
     OR p_signature !~ '^[a-f0-9]{64}$'
     OR encode(staff_security.hmac(convert_to('mfa-disable:' || p_payload, 'UTF8'), k, 'sha256'), 'hex') <> p_signature THEN
    RAISE EXCEPTION 'Invalid MFA disable signature' USING ERRCODE = '42501';
  END IF;
  c := p_payload::jsonb;
  IF NOT (c ?& ARRAY['userId','tokenVersion','secretHash','nonce','exp'])
     OR coalesce(c->>'userId', '') !~ '^[1-9][0-9]*$'
     OR coalesce(c->>'tokenVersion', '') !~ '^[0-9]+$'
     OR coalesce(c->>'secretHash', '') !~ '^[a-f0-9]{64}$'
     OR coalesce(c->>'nonce', '') !~ '^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$'
     OR coalesce(c->>'exp', '') !~ '^[0-9]+$'
     OR (c->>'exp')::bigint <= extract(epoch FROM clock_timestamp())
     OR (c->>'exp')::bigint > extract(epoch FROM clock_timestamp()) + 60 THEN
    RAISE EXCEPTION 'Invalid MFA disable claims';
  END IF;
  -- Same lock order as staff grants/revocation and protected recovery.
  PERFORM pg_advisory_xact_lock(73421, 1);
  SELECT * INTO STRICT u FROM public."User" WHERE id = (c->>'userId')::integer FOR UPDATE;
  IF u."isBanned" IS DISTINCT FROM false OR u."deletedAt" IS NOT NULL
     OR u."twoFactorEnabled" IS DISTINCT FROM true OR u."totpSecretEnc" IS NULL
     OR u."tokenVersion" IS DISTINCT FROM (c->>'tokenVersion')::integer
     OR encode(sha256(convert_to(u."totpSecretEnc", 'UTF8')), 'hex') <> c->>'secretHash' THEN
    RAISE EXCEPTION 'MFA session unavailable';
  END IF;
  IF u."role" = 'ADMIN'
     OR EXISTS (SELECT 1 FROM public."FounderOwnership" WHERE "userId" = u.id)
     OR EXISTS (SELECT 1 FROM public."StaffAssignment" WHERE "userId" = u.id AND active) THEN
    RETURN 'mfa_required';
  END IF;
  -- The insert provides both an immutable audit record and replay protection.
  INSERT INTO staff_security.mfa_disable_event(nonce, user_id, previous_token_version)
  VALUES ((c->>'nonce')::uuid, u.id, u."tokenVersion");
  UPDATE public."User" SET "twoFactorEnabled" = false, "totpSecretEnc" = NULL,
    "twoFactorEnrolledAt" = NULL, "tokenVersion" = "tokenVersion" + 1 WHERE id = u.id;
  DELETE FROM public."TwoFactorRecoveryCode" WHERE "userId" = u.id;
  UPDATE public."VerificationToken" SET "usedAt" = clock_timestamp()
  WHERE "userId" = u.id AND starts_with(type, 'mfa_') AND "usedAt" IS NULL;
  RETURN 'disabled';
END;
$fn$;
ALTER FUNCTION staff_security.disable_mfa(text,text) OWNER TO chatforia_staff_owner;
REVOKE ALL ON FUNCTION staff_security.disable_mfa(text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION staff_security.disable_mfa(text,text) TO chatforia_dev;
