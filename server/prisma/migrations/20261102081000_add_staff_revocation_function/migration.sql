-- Chatforia Staff Access / Step 606
-- Protected delegated staff revocation entry point.
-- Requires prior staff_security verifier/consumer and Step 605 privilege setup.
-- Apply only through the migration executor; application role receives EXECUTE only.

CREATE FUNCTION staff_security.revoke_staff_access(
  p_assertion TEXT,
  p_reason TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, staff_security, pg_temp
AS $function$
DECLARE
  v_claims JSONB;
  v_actor_id INTEGER;
  v_target_id INTEGER;
  v_asserted_profile TEXT;
  v_token_version INTEGER;
  v_founder RECORD;
  v_user_id INTEGER;
  v_actor RECORD;
  v_target RECORD;
  v_actor_assignment RECORD;
  v_target_assignment RECORD;
  v_allowed_profiles TEXT[];
  v_previous_profile TEXT;
  v_reason TEXT;
  v_now TIMESTAMP(3);
BEGIN
  v_reason := pg_catalog.btrim(p_reason);
  IF v_reason IS NULL OR pg_catalog.length(v_reason) NOT BETWEEN 5 AND 500 THEN
    RAISE EXCEPTION 'Staff revocation reason is required.';
  END IF;

  -- Claims must come from the database verifier, not caller-supplied IDs.
  v_claims := staff_security.verify_staff_assertion(p_assertion);
  IF v_claims->>'action' IS DISTINCT FROM 'STAFF_ACCESS_REVOKE' THEN
    RAISE EXCEPTION 'Invalid staff revocation assertion action';
  END IF;

  v_actor_id := (v_claims->>'actorUserId')::INTEGER;
  v_target_id := (v_claims->>'targetUserId')::INTEGER;
  v_asserted_profile := v_claims->>'targetProfile';
  v_token_version := (v_claims->>'tokenVersion')::INTEGER;

  -- Founder lock must be acquired before staff-management participant locks.
  PERFORM pg_catalog.pg_advisory_xact_lock(73421, 1);
  SELECT f."userId", u."id", u."isBanned", u."deletedAt"
    INTO v_founder
  FROM public."FounderOwnership" AS f
  JOIN public."User" AS u ON u."id" = f."userId"
  WHERE f."id" = 1;

  IF NOT FOUND OR v_founder."userId" IS NULL
    OR v_founder."isBanned" IS DISTINCT FROM FALSE
    OR v_founder."deletedAt" IS NOT NULL THEN
    RAISE EXCEPTION 'Protected founder identity is not initialized or valid.';
  END IF;
  IF v_actor_id = v_founder."userId" OR v_target_id = v_founder."userId" THEN
    RAISE EXCEPTION 'Founder account cannot participate in delegated staff management.';
  END IF;

  -- Lock participants in stable ascending user ID order.
  FOR v_user_id IN
    SELECT id FROM (VALUES (v_actor_id), (v_target_id)) AS ids(id)
    ORDER BY id
  LOOP
    PERFORM 1 FROM public."User" WHERE "id" = v_user_id FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Staff-management account unavailable.';
    END IF;
  END LOOP;

  SELECT * INTO v_actor FROM public."User" WHERE "id" = v_actor_id;
  SELECT * INTO v_target FROM public."User" WHERE "id" = v_target_id;

  -- Revocation deliberately does NOT require the target to have valid MFA,
  -- email verification, or an unbanned/undeleted account. The actor must
  -- still satisfy the current staff-actor requirements.
  IF v_actor."isBanned" IS DISTINCT FROM FALSE
    OR v_actor."deletedAt" IS NOT NULL
    OR v_actor."isSystem" IS DISTINCT FROM FALSE
    OR v_actor."isTestAccount" IS DISTINCT FROM FALSE
    OR v_actor."role" = 'ADMIN'
    OR v_actor."twoFactorEnabled" IS DISTINCT FROM TRUE
    OR v_actor."twoFactorEnrolledAt" IS NULL
    OR NULLIF(v_actor."totpSecretEnc", '') IS NULL
    OR v_target."id" IS DISTINCT FROM v_target_id
    OR v_target."role" IS DISTINCT FROM 'USER'
    OR v_target."isSystem" IS DISTINCT FROM FALSE
    OR v_target."isTestAccount" IS DISTINCT FROM FALSE THEN
    RAISE EXCEPTION 'Staff revocation account eligibility denied.';
  END IF;

  IF v_actor."tokenVersion" IS DISTINCT FROM v_token_version THEN
    RAISE EXCEPTION 'Staff session is no longer current.';
  END IF;

  SELECT * INTO v_actor_assignment
  FROM public."StaffAssignment"
  WHERE "userId" = v_actor_id
  FOR UPDATE;

  IF NOT FOUND
    OR v_actor_assignment."active" IS DISTINCT FROM TRUE
    OR v_actor_assignment."revokedAt" IS NOT NULL
    OR v_actor_assignment."revokedById" IS NOT NULL THEN
    RAISE EXCEPTION 'Staff revocation authority denied.';
  END IF;

  v_allowed_profiles := CASE v_actor_assignment."profile"
    WHEN 'CTO' THEN ARRAY['ENGINEERING_MANAGER', 'SENIOR_ENGINEER']::TEXT[]
    WHEN 'ACCESS_ADMIN' THEN ARRAY['SENIOR_ENGINEER', 'SUPPORT']::TEXT[]
    ELSE ARRAY[]::TEXT[]
  END;

  SELECT * INTO v_target_assignment
  FROM public."StaffAssignment"
  WHERE "userId" = v_target_id
  FOR UPDATE;

  -- Deny absent, already inactive, or out-of-scope assignments.
  -- Match the signed target profile to prevent applying a previously
  -- issued assertion to a different current target profile.
  IF NOT FOUND
    OR v_target_assignment."active" IS DISTINCT FROM TRUE
    OR v_target_assignment."profile" IS DISTINCT FROM v_asserted_profile
    OR NOT (v_target_assignment."profile" = ANY(v_allowed_profiles)) THEN
    RAISE EXCEPTION 'Staff revocation authority denied.';
  END IF;

  v_previous_profile := v_target_assignment."profile";
  v_now := pg_catalog.clock_timestamp()::TIMESTAMP(3);

  -- Single-use assertion, assignment change, session invalidation, and
  -- append-only history share the caller's transaction.
  PERFORM staff_security.consume_staff_assertion(p_assertion);

  UPDATE public."StaffAssignment"
  SET "active" = FALSE,
      "revokedById" = v_actor_id,
      "revokedAt" = v_now,
      "updatedAt" = v_now
  WHERE "userId" = v_target_id;

  UPDATE public."User"
  SET "tokenVersion" = "tokenVersion" + 1
  WHERE "id" = v_target_id;

  INSERT INTO public."StaffAccessEvent" (
    "actorUserId", "subjectUserId", "action",
    "previousProfile", "newProfile", "reason"
  ) VALUES (
    v_actor_id, v_target_id, 'STAFF_ACCESS_REVOKED',
    v_previous_profile, NULL, v_reason
  );

  INSERT INTO public."AuditLog" (
    "actorId", "action", "resource", "resourceId", "status", "metadata"
  ) VALUES (
    v_actor_id, 'STAFF_ACCESS_REVOKED', 'staff_assignment',
    v_target_id::TEXT, 200,
    pg_catalog.jsonb_build_object(
      'previousProfile', v_previous_profile,
      'newProfile', NULL,
      'sessionsRevoked', TRUE
    )
  );

  RETURN pg_catalog.jsonb_build_object(
    'action', 'STAFF_ACCESS_REVOKED',
    'targetUserId', v_target_id,
    'previousProfile', v_previous_profile,
    'sessionsRevoked', TRUE
  );
END;
$function$;

ALTER FUNCTION staff_security.revoke_staff_access(TEXT, TEXT)
OWNER TO chatforia_staff_owner;

REVOKE ALL ON FUNCTION staff_security.revoke_staff_access(TEXT, TEXT)
FROM PUBLIC;

GRANT EXECUTE ON FUNCTION staff_security.revoke_staff_access(TEXT, TEXT)
TO chatforia_dev;
