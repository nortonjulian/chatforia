-- PostgreSQL-side Staff Access assertion verification.
-- This function validates assertions but does not consume them
-- or modify staff assignments.

GRANT USAGE ON SCHEMA staff_security
TO chatforia_staff_owner;

GRANT SELECT ON staff_security.assertion_secrets
TO chatforia_staff_owner;

GRANT EXECUTE ON FUNCTION
  staff_security.hmac(bytea, bytea, text)
TO chatforia_staff_owner;

-- Fixed-work comparison for 32-byte HMAC signatures.
-- This avoids early exit on the first differing byte.
-- It is not a formal constant-time guarantee from PostgreSQL.

CREATE OR REPLACE FUNCTION
staff_security.signature_matches(p_left BYTEA, p_right BYTEA)
RETURNS BOOLEAN
LANGUAGE plpgsql
IMMUTABLE
STRICT
SET search_path = pg_catalog, staff_security
AS $function$
DECLARE
  v_difference INTEGER := 0;
  v_index INTEGER;
BEGIN
  IF octet_length(p_left) <> 32
     OR octet_length(p_right) <> 32 THEN
    RETURN FALSE;
  END IF;

  FOR v_index IN 0..31 LOOP
    v_difference := v_difference |
      (get_byte(p_left, v_index) # get_byte(p_right, v_index));
  END LOOP;

  RETURN v_difference = 0;
END;
$function$;

ALTER FUNCTION staff_security.signature_matches(BYTEA, BYTEA)
OWNER TO chatforia_staff_owner;

REVOKE ALL ON FUNCTION
staff_security.signature_matches(BYTEA, BYTEA)
FROM PUBLIC;

GRANT EXECUTE ON FUNCTION
staff_security.signature_matches(BYTEA, BYTEA)
TO chatforia_staff_owner;

CREATE OR REPLACE FUNCTION
staff_security.verify_staff_assertion(p_token TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, staff_security
AS $function$
DECLARE
  v_secret BYTEA;
  v_payload TEXT;
  v_signature TEXT;
  v_supplied BYTEA;
  v_expected BYTEA;
  v_claims JSONB;
  v_now BIGINT;
  v_iat BIGINT;
  v_exp BIGINT;
  v_actor BIGINT;
  v_target BIGINT;
  v_version BIGINT;
  v_action TEXT;
  v_profile TEXT;
  v_jti UUID;
BEGIN
  IF p_token IS NULL OR length(p_token) > 4096 THEN
    RAISE EXCEPTION 'Invalid staff assertion';
  END IF;

  IF length(p_token) - length(replace(p_token, '.', '')) <> 1 THEN
    RAISE EXCEPTION 'Invalid staff assertion format';
  END IF;

  v_payload := split_part(p_token, '.', 1);
  v_signature := split_part(p_token, '.', 2);

  IF v_payload = '' OR v_signature = ''
     OR v_payload !~ '^[A-Za-z0-9_-]+$'
     OR v_signature !~ '^[A-Za-z0-9_-]+$' THEN
    RAISE EXCEPTION 'Invalid staff assertion encoding';
  END IF;

  SELECT verification_secret
  INTO STRICT v_secret
  FROM staff_security.assertion_secrets
  WHERE id = 1
    AND key_version > 0;

  IF octet_length(v_secret) < 32 THEN
    RAISE EXCEPTION 'Invalid verification configuration';
  END IF;

  v_expected := staff_security.hmac(
    convert_to(v_payload, 'UTF8'),
    v_secret,
    'sha256'
  );

  v_supplied := decode(
    translate(v_signature, '-_', '+/') ||
    repeat('=', (4 - length(v_signature) % 4) % 4),
    'base64'
  );

  IF NOT staff_security.signature_matches(
    v_supplied,
    v_expected
  ) THEN
    RAISE EXCEPTION 'Invalid staff assertion signature';
  END IF;

  v_claims := convert_from(
    decode(
      translate(v_payload, '-_', '+/') ||
      repeat('=', (4 - length(v_payload) % 4) % 4),
      'base64'
    ),
    'UTF8'
  )::JSONB;

  IF jsonb_typeof(v_claims) <> 'object' THEN
    RAISE EXCEPTION 'Invalid staff assertion claims';
  END IF;

  IF (v_claims->>'iss') IS DISTINCT FROM 'chatforia-staff-access'
     OR (v_claims->>'aud') IS DISTINCT FROM 'chatforia-staff-database'
     OR (v_claims->>'typ') IS DISTINCT FROM 'staff_authorization'
     OR (v_claims->>'mfaVerified') IS DISTINCT FROM 'true' THEN
    RAISE EXCEPTION 'Invalid staff assertion identity';
  END IF;

  IF jsonb_typeof(v_claims->'actorUserId') IS DISTINCT FROM 'number'
     OR jsonb_typeof(v_claims->'targetUserId') IS DISTINCT FROM 'number'
     OR jsonb_typeof(v_claims->'tokenVersion') IS DISTINCT FROM 'number'
     OR jsonb_typeof(v_claims->'iat') IS DISTINCT FROM 'number'
     OR jsonb_typeof(v_claims->'exp') IS DISTINCT FROM 'number' THEN
    RAISE EXCEPTION 'Invalid staff assertion numeric claims';
  END IF;

  IF v_claims->>'actorUserId' !~ '^[1-9][0-9]{0,9}$'
     OR v_claims->>'targetUserId' !~ '^[1-9][0-9]{0,9}$'
     OR v_claims->>'tokenVersion' !~ '^(0|[1-9][0-9]{0,9})$'
     OR v_claims->>'iat' !~ '^[0-9]{1,12}$'
     OR v_claims->>'exp' !~ '^[0-9]{1,12}$' THEN
    RAISE EXCEPTION 'Invalid staff assertion numeric values';
  END IF;

  v_actor := (v_claims->>'actorUserId')::BIGINT;
  v_target := (v_claims->>'targetUserId')::BIGINT;
  v_version := (v_claims->>'tokenVersion')::BIGINT;
  v_iat := (v_claims->>'iat')::BIGINT;
  v_exp := (v_claims->>'exp')::BIGINT;

  IF v_actor > 2147483647 OR v_target > 2147483647
     OR v_actor = v_target THEN
    RAISE EXCEPTION 'Invalid staff assertion account IDs';
  END IF;

  IF v_claims->>'action' IS NULL OR v_claims->>'action' NOT IN (
    'STAFF_ACCESS_GRANT_OR_CHANGE',
    'STAFF_ACCESS_REVOKE'
  ) THEN
    RAISE EXCEPTION 'Invalid staff assertion action';
  END IF;

  IF v_claims->>'targetProfile' IS NULL OR v_claims->>'targetProfile' NOT IN (
    'CTO',
    'ENGINEERING_MANAGER',
    'SENIOR_ENGINEER',
    'SUPPORT',
    'ACCESS_ADMIN'
  ) THEN
    RAISE EXCEPTION 'Invalid staff assertion profile';
  END IF;

  IF v_claims->>'jti' IS NULL OR v_claims->>'jti' !~
    '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
  THEN
    RAISE EXCEPTION 'Invalid staff assertion identifier';
  END IF;

  v_jti := (v_claims->>'jti')::UUID;
  v_now := extract(epoch FROM clock_timestamp())::BIGINT;

  IF v_iat > v_now + 5
     OR v_exp <= v_now
     OR v_exp <= v_iat
     OR v_exp - v_iat > 60 THEN
    RAISE EXCEPTION 'Expired or invalid staff assertion';
  END IF;

  RETURN v_claims;
END;
$function$;

ALTER FUNCTION staff_security.verify_staff_assertion(TEXT)
OWNER TO chatforia_staff_owner;

REVOKE ALL ON FUNCTION
staff_security.verify_staff_assertion(TEXT)
FROM PUBLIC;

GRANT EXECUTE ON FUNCTION
staff_security.verify_staff_assertion(TEXT)
TO chatforia_dev;
