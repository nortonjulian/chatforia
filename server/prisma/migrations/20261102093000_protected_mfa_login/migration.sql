-- Signed, short-lived login-token writes. Runtime SQL credentials alone cannot
-- create MFA challenges, change attempts, or consume backup codes for staff.
CREATE TABLE staff_security.mfa_login_assertions (
  nonce uuid PRIMARY KEY,
  expires_at timestamptz NOT NULL
);
ALTER TABLE staff_security.mfa_login_assertions OWNER TO chatforia_staff_owner;
REVOKE ALL ON staff_security.mfa_login_assertions FROM PUBLIC, chatforia_dev;

CREATE FUNCTION staff_security.mfa_login_write(p_payload text, p_signature text)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, staff_security, pg_temp
AS $fn$
DECLARE
  c jsonb;
  u public."User"%ROWTYPE;
  k bytea;
  n integer;
  attempts integer;
BEGIN
  SELECT verification_secret INTO STRICT k FROM staff_security.assertion_secrets WHERE id = 1;
  IF p_payload IS NULL OR length(p_payload) > 4096 OR p_signature IS NULL
     OR p_signature !~ '^[a-f0-9]{64}$'
     OR encode(staff_security.hmac(convert_to('mfa-login:' || p_payload, 'UTF8'), k, 'sha256'), 'hex') <> p_signature THEN
    RAISE EXCEPTION 'Invalid MFA write signature' USING ERRCODE = '42501';
  END IF;
  c := p_payload::jsonb;
  IF NOT (c ?& ARRAY['userId','tokenVersion','exp','nonce','operation','tokenHash'])
     OR (c->>'exp')::bigint <= extract(epoch FROM clock_timestamp())
     OR (c->>'exp')::bigint > extract(epoch FROM clock_timestamp()) + 60
     OR (c->>'tokenHash') !~ '^[a-f0-9]{64}$'
     OR c->>'operation' NOT IN ('CREATE','FAIL','COMPLETE') THEN
    RAISE EXCEPTION 'Invalid MFA write claims';
  END IF;
  SELECT * INTO STRICT u FROM public."User" WHERE id = (c->>'userId')::integer FOR UPDATE;
  IF u."isBanned" OR u."deletedAt" IS NOT NULL OR NOT u."twoFactorEnabled"
     OR u."totpSecretEnc" IS NULL OR u."tokenVersion" IS DISTINCT FROM (c->>'tokenVersion')::integer THEN
    RAISE EXCEPTION 'MFA session unavailable';
  END IF;
  INSERT INTO staff_security.mfa_login_assertions VALUES ((c->>'nonce')::uuid, to_timestamp((c->>'exp')::bigint));
  IF c->>'operation' = 'CREATE' THEN
    INSERT INTO public."VerificationToken" ("userId",type,"tokenHash","expiresAt")
    VALUES (u.id, 'mfa_login:0', c->>'tokenHash', (clock_timestamp() + interval '5 minutes') AT TIME ZONE 'UTC');
    RETURN 1;
  END IF;
  SELECT split_part(type, ':', 2)::integer INTO attempts
  FROM public."VerificationToken"
  WHERE id = (c->>'recordId')::integer AND "userId" = u.id AND "tokenHash" = c->>'tokenHash'
    AND type ~ '^mfa_login:[0-4]$' AND "usedAt" IS NULL AND "expiresAt" > (clock_timestamp() AT TIME ZONE 'UTC')
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'MFA challenge unavailable'; END IF;
  IF c->>'operation' = 'FAIL' THEN
    UPDATE public."VerificationToken" SET type = 'mfa_login:' || (attempts + 1),
      "usedAt" = CASE WHEN attempts = 4 THEN clock_timestamp() ELSE NULL END
    WHERE id = (c->>'recordId')::integer;
  ELSE
    IF c->>'recoveryId' IS NOT NULL THEN
      UPDATE public."TwoFactorRecoveryCode" SET "usedAt" = clock_timestamp()
      WHERE id = (c->>'recoveryId')::integer AND "userId" = u.id AND "usedAt" IS NULL;
      GET DIAGNOSTICS n = ROW_COUNT;
      IF n <> 1 THEN RAISE EXCEPTION 'Recovery code already consumed'; END IF;
    END IF;
    UPDATE public."VerificationToken" SET "usedAt" = clock_timestamp()
    WHERE id = (c->>'recordId')::integer;
  END IF;
  RETURN 1;
END;
$fn$;
ALTER FUNCTION staff_security.mfa_login_write(text,text) OWNER TO chatforia_staff_owner;
REVOKE ALL ON FUNCTION staff_security.mfa_login_write(text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION staff_security.mfa_login_write(text,text) TO chatforia_dev;
