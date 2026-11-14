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

-- Re-enrollment is equally constrained; it cannot replace an enabled secret or
-- recover an active staff/founder identity through the public enrollment route.
CREATE TABLE staff_security.mfa_enrollment_event (
  nonce uuid PRIMARY KEY,
  user_id integer NOT NULL,
  operation text NOT NULL CHECK (operation IN ('SETUP', 'ENABLE')),
  previous_token_version integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE staff_security.mfa_enrollment_event OWNER TO chatforia_staff_owner;
REVOKE ALL ON staff_security.mfa_enrollment_event FROM PUBLIC, chatforia_dev;

CREATE FUNCTION staff_security.enroll_mfa(p_payload text, p_signature text)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, staff_security, pg_temp
AS $fn$
DECLARE
  c jsonb;
  u public."User"%ROWTYPE;
  k bytea;
  pending public."VerificationToken"%ROWTYPE;
BEGIN
  SELECT verification_secret INTO STRICT k FROM staff_security.assertion_secrets WHERE id = 1;
  IF p_payload IS NULL OR length(p_payload) > 8192 OR p_signature IS NULL
     OR p_signature !~ '^[a-f0-9]{64}$'
     OR encode(staff_security.hmac(convert_to('mfa-enroll:' || p_payload, 'UTF8'), k, 'sha256'), 'hex') <> p_signature THEN
    RAISE EXCEPTION 'Invalid MFA enrollment signature' USING ERRCODE = '42501';
  END IF;
  c := p_payload::jsonb;
  IF NOT (c ?& ARRAY['userId','tokenVersion','nonce','exp','operation'])
     OR coalesce(c->>'userId', '') !~ '^[1-9][0-9]*$'
     OR coalesce(c->>'tokenVersion', '') !~ '^[0-9]+$'
     OR coalesce(c->>'nonce', '') !~ '^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$'
     OR coalesce(c->>'exp', '') !~ '^[0-9]+$'
     OR coalesce(c->>'operation', '') NOT IN ('SETUP','ENABLE')
     OR (c->>'exp')::bigint <= extract(epoch FROM clock_timestamp())
     OR (c->>'exp')::bigint > extract(epoch FROM clock_timestamp()) + 60 THEN
    RAISE EXCEPTION 'Invalid MFA enrollment claims';
  END IF;
  PERFORM pg_advisory_xact_lock(73421, 1);
  SELECT * INTO STRICT u FROM public."User" WHERE id = (c->>'userId')::integer FOR UPDATE;
  IF u."isBanned" IS DISTINCT FROM false OR u."deletedAt" IS NOT NULL
     OR u."twoFactorEnabled" IS DISTINCT FROM false OR u."totpSecretEnc" IS NOT NULL
     OR u."tokenVersion" IS DISTINCT FROM (c->>'tokenVersion')::integer THEN
    RAISE EXCEPTION 'MFA enrollment unavailable';
  END IF;
  IF u."role" = 'ADMIN'
     OR EXISTS (SELECT 1 FROM public."FounderOwnership" WHERE "userId" = u.id)
     OR EXISTS (SELECT 1 FROM public."StaffAssignment" WHERE "userId" = u.id AND active) THEN
    RETURN 'mfa_protected';
  END IF;
  IF c->>'operation' = 'SETUP' THEN
    IF jsonb_typeof(c->'secretEnc') IS DISTINCT FROM 'string'
       OR length(c->>'secretEnc') NOT BETWEEN 40 AND 4096 THEN
      RAISE EXCEPTION 'Invalid encrypted MFA enrollment secret';
    END IF;
  ELSE
    IF coalesce(c->>'recordId', '') !~ '^[1-9][0-9]*$'
       OR coalesce(c->>'pendingHash', '') !~ '^[a-f0-9]{64}$'
       OR jsonb_typeof(c->'recoveryHashes') IS DISTINCT FROM 'array' THEN
      RAISE EXCEPTION 'Invalid MFA enrollment binding';
    END IF;
    IF jsonb_array_length(c->'recoveryHashes') <> 10
       OR (SELECT count(DISTINCT value) FROM jsonb_array_elements_text(c->'recoveryHashes')) <> 10
       OR EXISTS (SELECT FROM jsonb_array_elements_text(c->'recoveryHashes') h(value)
                  WHERE value IS NULL OR value !~ '^[a-f0-9]{64}$') THEN
      RAISE EXCEPTION 'Invalid MFA recovery hashes';
    END IF;
    SELECT * INTO pending FROM public."VerificationToken"
    WHERE id = (c->>'recordId')::integer AND "userId" = u.id
      AND type = 'mfa_setup' AND "usedAt" IS NULL
      AND "expiresAt" > (clock_timestamp() AT TIME ZONE 'UTC') FOR UPDATE;
    IF NOT FOUND OR encode(sha256(convert_to(pending."tokenHash", 'UTF8')), 'hex') <> c->>'pendingHash' THEN
      RAISE EXCEPTION 'Pending MFA enrollment unavailable';
    END IF;
  END IF;
  INSERT INTO staff_security.mfa_enrollment_event(nonce,user_id,operation,previous_token_version)
  VALUES ((c->>'nonce')::uuid,u.id,c->>'operation',u."tokenVersion");
  UPDATE public."VerificationToken" SET "usedAt" = clock_timestamp()
  WHERE "userId" = u.id AND type = 'mfa_setup' AND "usedAt" IS NULL;
  IF c->>'operation' = 'SETUP' THEN
    INSERT INTO public."VerificationToken"("userId",type,"tokenHash","expiresAt")
    VALUES(u.id,'mfa_setup',c->>'secretEnc',(clock_timestamp() + interval '10 minutes') AT TIME ZONE 'UTC');
    RETURN 'prepared';
  END IF;
  UPDATE public."User" SET "twoFactorEnabled" = true, "totpSecretEnc" = pending."tokenHash",
    "twoFactorEnrolledAt" = clock_timestamp(), "tokenVersion" = "tokenVersion" + 1 WHERE id=u.id;
  DELETE FROM public."TwoFactorRecoveryCode" WHERE "userId"=u.id;
  INSERT INTO public."TwoFactorRecoveryCode"("userId","codeHash")
  SELECT u.id, value FROM jsonb_array_elements_text(c->'recoveryHashes');
  RETURN 'enabled';
END;
$fn$;
ALTER FUNCTION staff_security.enroll_mfa(text,text) OWNER TO chatforia_staff_owner;
REVOKE ALL ON FUNCTION staff_security.enroll_mfa(text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION staff_security.enroll_mfa(text,text) TO chatforia_dev;
