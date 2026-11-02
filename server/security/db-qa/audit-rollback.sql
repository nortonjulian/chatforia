\set ON_ERROR_STOP on
\getenv qa_secret QA_SECRET
\getenv qa_assertion QA_ASSERTION

BEGIN;
\ir staff-qa-fixtures.sql

-- Verify expected employee state.
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
      AND s."active"
  ) OR NOT EXISTS (
    SELECT 1
    FROM public."User" u
    JOIN public."StaffAssignment" s
      ON s."userId" = u."id"
    WHERE u."id" = 16
      AND u."tokenVersion" = 5
      AND s."profile" = 'SUPPORT'
      AND s."active"
  ) THEN
    RAISE EXCEPTION 'STOP: Unexpected QA fixtures';
  END IF;
END;
$fixture$;

CREATE TEMP TABLE qa_audit_baseline ON COMMIT DROP AS
SELECT
  (SELECT count(*) FROM staff_security.consumed_assertions)
    AS consumed,
  (SELECT count(*) FROM public."StaffAccessEvent")
    AS history,
  (SELECT count(*) FROM public."AuditLog")
    AS audits;

UPDATE staff_security.assertion_secrets
SET verification_secret = convert_to(:'qa_secret', 'UTF8')
WHERE id = 1 AND key_version = 3;

CREATE FUNCTION pg_temp.qa_reject_audit()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $trigger$
BEGIN
  IF NEW."action" = 'STAFF_PROFILE_CHANGED'
     AND NEW."actorId" = 17
     AND NEW."resourceId" = '16' THEN
    RAISE EXCEPTION 'QA_AUDIT_FAILURE_605O';
  END IF;
  RETURN NEW;
END;
$trigger$;

CREATE TRIGGER qa_605o_reject_staff_audit
BEFORE INSERT ON public."AuditLog"
FOR EACH ROW
EXECUTE FUNCTION pg_temp.qa_reject_audit();

-- Valid PostgreSQL custom parameter name.
-- Do not print the signed assertion.
SELECT set_config(
  'qa.audit_failure_assertion',
  :'qa_assertion',
  true
) \gset

SET LOCAL ROLE chatforia_dev;

DO $test$
DECLARE
  v_message TEXT;
BEGIN
  BEGIN
    PERFORM staff_security.grant_or_change_staff_access(
      current_setting('qa.audit_failure_assertion'),
      'Security QA forced audit failure 605O'
    );

    RAISE EXCEPTION 'FAIL: Audit failure was not enforced';

  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_message = MESSAGE_TEXT;

    IF v_message <> 'QA_AUDIT_FAILURE_605O' THEN
      RAISE EXCEPTION
        'FAIL: Unexpected error: %', v_message;
    END IF;

    RAISE NOTICE 'PASS: Forced audit failure reached and rejected';
  END;
END;
$test$;

RESET ROLE;

DO $verify$
DECLARE
  v_before RECORD;
BEGIN
  SELECT * INTO STRICT v_before
  FROM qa_audit_baseline;

  IF (SELECT count(*) FROM staff_security.consumed_assertions)
       <> v_before.consumed THEN
    RAISE EXCEPTION 'FAIL: Assertion remained consumed';
  END IF;

  IF (SELECT count(*) FROM public."StaffAccessEvent")
       <> v_before.history THEN
    RAISE EXCEPTION 'FAIL: Staff history retained';
  END IF;

  IF (SELECT count(*) FROM public."AuditLog")
       <> v_before.audits THEN
    RAISE EXCEPTION 'FAIL: Audit record retained';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public."User" u
    JOIN public."StaffAssignment" s
      ON s."userId" = u."id"
    WHERE u."id" = 16
      AND u."tokenVersion" = 5
      AND s."profile" = 'SUPPORT'
      AND s."active"
  ) THEN
    RAISE EXCEPTION 'FAIL: Assignment or session changed';
  END IF;

  RAISE NOTICE 'PASS: Assignment and session unchanged';
  RAISE NOTICE 'PASS: Staff history and audit unchanged';
  RAISE NOTICE 'PASS: Assertion consumption rolled back';
END;
$verify$;

ROLLBACK;
