-- Chatforia Staff Access / Step 605
-- Protected grant, profile-change and reactivation entry point.
-- Deployment prerequisite: DBA-provisioned chatforia_staff_owner, schema,
-- prior verifier/consumer functions, and narrowly scoped table privileges.

CREATE FUNCTION staff_security.grant_or_change_staff_access(
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
  v_profile TEXT;
  v_token_version INTEGER;
  v_founder_id INTEGER;
  v_founder RECORD;
  v_user_id INTEGER;
  v_actor RECORD;
  v_target RECORD;
  v_actor_assignment RECORD;
  v_existing RECORD;
  v_previous_profile TEXT;
  v_allowed_profiles TEXT[];
  v_action TEXT;
  v_now TIMESTAMP(3);
  v_reason TEXT;
BEGIN
  -- Do not permit empty, whitespace-only, or excessively long audit reasons.
  v_reason := btrim(p_reason);
  IF v_reason IS NULL OR length(v_reason) NOT BETWEEN 5 AND 500 THEN
    RAISE EXCEPTION 'Staff access change reason is required.';
  END IF;

  -- Verify before using claims; internal verifier is not callable by the app.
  v_claims := staff_security.verify_staff_assertion(p_assertion);
  IF v_claims->>'action' IS DISTINCT FROM 'STAFF_ACCESS_GRANT_OR_CHANGE' THEN
    RAISE EXCEPTION 'Invalid staff grant assertion action';
  END IF;

  v_actor_id := (v_claims->>'actorUserId')::INTEGER;
  v_target_id := (v_claims->>'targetUserId')::INTEGER;
  v_profile := v_claims->>'targetProfile';
  v_token_version := (v_claims->>'tokenVersion')::INTEGER;

  -- Founder coordination lock ALWAYS precedes participant row locks.
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
  v_founder_id := v_founder."userId";
  IF v_actor_id = v_founder_id OR v_target_id = v_founder_id THEN
    RAISE EXCEPTION 'Founder account cannot participate in delegated staff management.';
  END IF;

  -- Lock both user records individually and deterministically.
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

  -- Match the existing JS eligibility policy, using database rows only.
  IF v_actor."isBanned" IS DISTINCT FROM FALSE
    OR v_actor."deletedAt" IS NOT NULL
    OR v_actor."isSystem" IS DISTINCT FROM FALSE
    OR v_actor."isTestAccount" IS DISTINCT FROM FALSE
    OR v_actor."role" = 'ADMIN'
    OR v_actor."twoFactorEnabled" IS DISTINCT FROM TRUE
    OR v_actor."twoFactorEnrolledAt" IS NULL
    OR NULLIF(v_actor."totpSecretEnc", '') IS NULL
    OR v_target."isBanned" IS DISTINCT FROM FALSE
    OR v_target."deletedAt" IS NOT NULL
    OR v_target."isSystem" IS DISTINCT FROM FALSE
    OR v_target."isTestAccount" IS DISTINCT FROM FALSE
    OR v_target."role" IS DISTINCT FROM 'USER'
    OR v_target."emailVerifiedAt" IS NULL
    OR v_target."twoFactorEnabled" IS DISTINCT FROM TRUE
    OR v_target."twoFactorEnrolledAt" IS NULL
    OR NULLIF(v_target."totpSecretEnc", '') IS NULL THEN
    RAISE EXCEPTION 'Staff account eligibility denied.';
  END IF;

  IF v_actor."tokenVersion" IS DISTINCT FROM v_token_version THEN
    RAISE EXCEPTION 'Staff session is no longer current.';
  END IF;

  -- Assignment authority is current database state, not signed profile text.
  SELECT * INTO v_actor_assignment
  FROM public."StaffAssignment"
  WHERE "userId" = v_actor_id
  FOR UPDATE;
  IF NOT FOUND
    OR v_actor_assignment."active" IS DISTINCT FROM TRUE
    OR v_actor_assignment."revokedAt" IS NOT NULL
    OR v_actor_assignment."revokedById" IS NOT NULL THEN
    RAISE EXCEPTION 'Staff delegation authority denied.';
  END IF;

  v_allowed_profiles := CASE v_actor_assignment."profile"
    WHEN 'CTO' THEN ARRAY['ENGINEERING_MANAGER', 'SENIOR_ENGINEER']::TEXT[]
    WHEN 'ACCESS_ADMIN' THEN ARRAY['SENIOR_ENGINEER', 'SUPPORT']::TEXT[]
    ELSE ARRAY[]::TEXT[]
  END;
  IF NOT (v_profile = ANY(v_allowed_profiles)) THEN
    RAISE EXCEPTION 'Staff delegation authority denied.';
  END IF;

  SELECT * INTO v_existing
  FROM public."StaffAssignment"
  WHERE "userId" = v_target_id
  FOR UPDATE;

  IF FOUND AND NOT (v_existing."profile" = ANY(v_allowed_profiles)) THEN
    RAISE EXCEPTION 'Staff delegation authority denied.';
  END IF;

  v_previous_profile := v_existing."profile";

  -- Even no-ops are one-time authorized invocations. No account writes.
  IF v_existing."active" IS TRUE AND v_previous_profile = v_profile THEN
    PERFORM staff_security.consume_staff_assertion(p_assertion);
    RETURN pg_catalog.jsonb_build_object(
      'action', 'STAFF_ACCESS_UNCHANGED',
      'targetUserId', v_target_id,
      'profile', v_profile,
      'sessionsRevoked', FALSE
    );
  END IF;

  v_action := CASE
    WHEN v_existing."id" IS NULL THEN 'STAFF_ACCESS_GRANTED'
    WHEN v_existing."active" IS TRUE THEN 'STAFF_PROFILE_CHANGED'
    ELSE 'STAFF_ACCESS_REACTIVATED'
  END;
  v_now := clock_timestamp()::TIMESTAMP(3);

  -- Replay consumption and all mutations occur in the caller's transaction.
  PERFORM staff_security.consume_staff_assertion(p_assertion);

  IF v_existing."id" IS NULL THEN
    INSERT INTO public."StaffAssignment" (
      "userId", "profile", "active", "grantedById",
      "grantedAt", "revokedById", "revokedAt", "updatedAt"
    ) VALUES (
      v_target_id, v_profile, TRUE, v_actor_id,
      v_now, NULL, NULL, v_now
    );
  ELSE
    UPDATE public."StaffAssignment"
    SET "profile" = v_profile,
        "active" = TRUE,
        "grantedById" = v_actor_id,
        "grantedAt" = v_now,
        "revokedById" = NULL,
        "revokedAt" = NULL,
        "updatedAt" = v_now
    WHERE "userId" = v_target_id;
  END IF;

  UPDATE public."User"
  SET "tokenVersion" = "tokenVersion" + 1
  WHERE "id" = v_target_id;

  INSERT INTO public."StaffAccessEvent" (
    "actorUserId", "subjectUserId", "action",
    "previousProfile", "newProfile", "reason"
  ) VALUES (
    v_actor_id, v_target_id, v_action,
    v_previous_profile, v_profile, v_reason
  );

  INSERT INTO public."AuditLog" (
    "actorId", "action", "resource", "resourceId", "status", "metadata"
  ) VALUES (
    v_actor_id, v_action, 'staff_assignment', v_target_id::TEXT, 200,
    pg_catalog.jsonb_build_object(
      'previousProfile', v_previous_profile,
      'newProfile', v_profile,
      'sessionsRevoked', TRUE
    )
  );

  RETURN pg_catalog.jsonb_build_object(
    'action', v_action,
    'targetUserId', v_target_id,
    'profile', v_profile,
    'sessionsRevoked', TRUE
  );
END;
$function$;

ALTER FUNCTION staff_security.grant_or_change_staff_access(TEXT, TEXT)
OWNER TO chatforia_staff_owner;

REVOKE ALL ON FUNCTION staff_security.grant_or_change_staff_access(TEXT, TEXT)
FROM PUBLIC;

GRANT EXECUTE ON FUNCTION staff_security.grant_or_change_staff_access(TEXT, TEXT)
TO chatforia_dev;
