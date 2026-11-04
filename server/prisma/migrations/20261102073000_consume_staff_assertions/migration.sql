-- Atomically consume a verified Staff Access assertion.
-- Must execute inside the same transaction as the
-- protected staff mutation.

CREATE OR REPLACE FUNCTION
staff_security.consume_staff_assertion(p_token TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, staff_security
AS $function$
DECLARE
  v_claims JSONB;
  v_assertion_id UUID;
  v_inserted INTEGER;
BEGIN
  -- Independently verify the complete signed assertion.
  v_claims :=
    staff_security.verify_staff_assertion(p_token);

  v_assertion_id :=
    (v_claims->>'jti')::UUID;

  -- The primary key makes concurrent duplicate
  -- consumption attempts mutually exclusive.
  INSERT INTO staff_security.consumed_assertions (
    assertion_id,
    actor_user_id,
    target_user_id,
    action,
    target_profile,
    expires_at
  )
  VALUES (
    v_assertion_id,
    (v_claims->>'actorUserId')::INTEGER,
    (v_claims->>'targetUserId')::INTEGER,
    v_claims->>'action',
    v_claims->>'targetProfile',
    to_timestamp((v_claims->>'exp')::DOUBLE PRECISION)
  )
  ON CONFLICT (assertion_id) DO NOTHING;

  GET DIAGNOSTICS v_inserted = ROW_COUNT;

  IF v_inserted <> 1 THEN
    RAISE EXCEPTION 'Staff authorization assertion already consumed';
  END IF;

  RETURN v_claims;
END;
$function$;

ALTER FUNCTION
staff_security.consume_staff_assertion(TEXT)
OWNER TO chatforia_staff_owner;

REVOKE ALL ON FUNCTION
staff_security.consume_staff_assertion(TEXT)
FROM PUBLIC;

GRANT EXECUTE ON FUNCTION
staff_security.consume_staff_assertion(TEXT)
TO chatforia_dev;
