\set ON_ERROR_STOP on
\getenv qa_secret QA_SECRET
\getenv qa_assertion QA_ASSERTION

BEGIN;
\ir staff-qa-fixtures.sql

-- Verify that our synthetic QA fixtures are unchanged.
DO $fixture$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public."User" u
    JOIN public."StaffAssignment" s
      ON s."userId" = u."id"
    WHERE u."id" = 17
      AND u."tokenVersion" = 0
      AND s."profile" = 'ACCESS_ADMIN'
      AND s."active" = true
  ) OR NOT EXISTS (
    SELECT 1
    FROM public."User" u
    JOIN public."StaffAssignment" s
      ON s."userId" = u."id"
    WHERE u."id" = 18
      AND u."tokenVersion" = 2
      AND s."profile" = 'SUPPORT'
      AND s."active" = true
  ) THEN
    RAISE EXCEPTION 'STOP: Unexpected QA fixtures';
  END IF;
END;
$fixture$;

CREATE TEMP TABLE qa_revocation_baseline ON COMMIT DROP AS
SELECT
  (SELECT count(*) FROM public."StaffAccessEvent") AS history,
  (SELECT count(*) FROM public."AuditLog") AS audits,
  (SELECT count(*) FROM staff_security.consumed_assertions) AS consumed;

-- Temporary QA key, restored by ROLLBACK.
UPDATE staff_security.assertion_secrets
SET verification_secret = convert_to(:'qa_secret', 'UTF8')
WHERE id = 1 AND key_version = 3;

-- Store the signed assertion without displaying it.
SELECT set_config(
  'qa.revocation_assertion', :'qa_assertion', true
) \gset

-- Permit the test identity to read this temporary QA fixture only.
GRANT SELECT ON TABLE pg_temp.qa_revocation_baseline
TO chatforia_dev;

SET LOCAL ROLE chatforia_dev;

DO $test$
DECLARE
  v_result JSONB;
  v_history BIGINT;
  v_audits BIGINT;
  v_consumed BIGINT;
BEGIN
  v_result := staff_security.revoke_staff_access(
    current_setting('qa.revocation_assertion'),
    'Security QA revocation test 606E'
  );

  IF v_result IS DISTINCT FROM jsonb_build_object(
    'action', 'STAFF_ACCESS_REVOKED',
    'targetUserId', 18,
    'previousProfile', 'SUPPORT',
    'sessionsRevoked', true
  ) THEN
    RAISE EXCEPTION 'FAIL: Incorrect revocation response';
  END IF;

  RAISE NOTICE 'PASS: Protected revocation returned expected response';

  IF NOT EXISTS (
    SELECT 1
    FROM public."User" u
    JOIN public."StaffAssignment" s
      ON s."userId" = u."id"
    WHERE u."id" = 18
      AND u."role" = 'USER'
      AND u."tokenVersion" = 3
      AND s."profile" = 'SUPPORT'
      AND s."active" = false
      AND s."revokedById" = 17
      AND s."revokedAt" IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'FAIL: Revocation or session invalidation incorrect';
  END IF;

  RAISE NOTICE 'PASS: Staff revoked, ordinary account preserved, sessions invalidated';

  IF NOT EXISTS (
    SELECT 1 FROM public."StaffAccessEvent"
    WHERE "actorUserId" = 17
      AND "subjectUserId" = 18
      AND "action" = 'STAFF_ACCESS_REVOKED'
      AND "previousProfile" = 'SUPPORT'
      AND "newProfile" IS NULL
      AND "reason" = 'Security QA revocation test 606E'
  ) THEN
    RAISE EXCEPTION 'FAIL: Staff history missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public."AuditLog"
    WHERE "actorId" = 17
      AND "action" = 'STAFF_ACCESS_REVOKED'
      AND "resource" = 'staff_assignment'
      AND "resourceId" = '18'
      AND "status" = 200
      AND "metadata"->>'previousProfile' = 'SUPPORT'
      AND "metadata"->>'sessionsRevoked' = 'true'
  ) THEN
    RAISE EXCEPTION 'FAIL: Audit record missing';
  END IF;

  SELECT count(*) INTO v_history FROM public."StaffAccessEvent";
  SELECT count(*) INTO v_audits FROM public."AuditLog";

  -- The app cannot query the protected replay registry.
  -- We verify that separately after RESET ROLE.

  IF v_history <> (SELECT history + 1 FROM qa_revocation_baseline)
     OR v_audits <> (SELECT audits + 1 FROM qa_revocation_baseline)
  THEN
    RAISE EXCEPTION 'FAIL: Unexpected audit/history count';
  END IF;

  RAISE NOTICE 'PASS: Mandatory history and audit records created';
END;
$test$;

RESET ROLE;

DO $verify$
BEGIN
  IF (SELECT count(*) FROM staff_security.consumed_assertions)
     <> (SELECT consumed + 1 FROM qa_revocation_baseline) THEN
    RAISE EXCEPTION 'FAIL: Assertion not consumed exactly once';
  END IF;

  RAISE NOTICE 'PASS: Assertion consumed exactly once';
END;
$verify$;

ROLLBACK;
