\set ON_ERROR_STOP on
\getenv qa_secret QA_SECRET
\getenv qa_repeat QA_REPEAT
\getenv qa_unauthorized QA_UNAUTHORIZED

BEGIN;
\ir staff-qa-fixtures.sql

DO $fixture$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public."User" u
    JOIN public."StaffAssignment" s ON s."userId" = u."id"
    WHERE u."id" = 14 AND u."tokenVersion" = 0
      AND s."profile" = 'CTO' AND s."active"
  ) OR NOT EXISTS (
    SELECT 1 FROM public."User" u
    JOIN public."StaffAssignment" s ON s."userId" = u."id"
    WHERE u."id" = 17 AND u."tokenVersion" = 0
      AND s."profile" = 'ACCESS_ADMIN' AND s."active"
  ) OR NOT EXISTS (
    SELECT 1 FROM public."StaffAssignment"
    WHERE "userId" = 15
      AND "profile" = 'SENIOR_ENGINEER'
      AND "active" = false
  ) THEN
    RAISE EXCEPTION 'STOP: Unexpected test fixtures';
  END IF;
END;
$fixture$;

CREATE TEMP TABLE qa_revocation_denial_baseline ON COMMIT DROP AS
SELECT
  (SELECT count(*) FROM staff_security.consumed_assertions) AS consumed,
  (SELECT count(*) FROM public."StaffAccessEvent") AS history,
  (SELECT count(*) FROM public."AuditLog") AS audits;

UPDATE staff_security.assertion_secrets
SET verification_secret = convert_to(:'qa_secret', 'UTF8')
WHERE id = 1 AND key_version = 3;

-- Store assertions without displaying their values.
SELECT set_config('qa.repeat_revoke_token', :'qa_repeat', true) \gset
SELECT set_config('qa.unauthorized_revoke_token', :'qa_unauthorized', true) \gset

SET LOCAL ROLE chatforia_dev;

DO $tests$
DECLARE
  v_error TEXT;
  v_case RECORD;
BEGIN
  FOR v_case IN
    SELECT *
    FROM (VALUES
      ('Repeated revocation',
       current_setting('qa.repeat_revoke_token')),
      ('Unauthorized CTO revocation',
       current_setting('qa.unauthorized_revoke_token'))
    ) AS cases(description, token)
  LOOP
    BEGIN
      PERFORM staff_security.revoke_staff_access(
        v_case.token,
        'Security QA denied revocation 606F'
      );

      RAISE EXCEPTION 'FAIL: Revocation accepted: %',
        v_case.description;

    EXCEPTION WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS v_error = MESSAGE_TEXT;

      IF v_error <> 'Staff revocation authority denied.' THEN
        RAISE EXCEPTION 'FAIL: %: %',
          v_case.description, v_error;
      END IF;

      RAISE NOTICE 'PASS: % denied', v_case.description;
    END;
  END LOOP;
END;
$tests$;

RESET ROLE;

DO $verify$
DECLARE
  v_before RECORD;
BEGIN
  SELECT * INTO STRICT v_before
  FROM qa_revocation_denial_baseline;

  IF (SELECT count(*) FROM staff_security.consumed_assertions)
       <> v_before.consumed
    OR (SELECT count(*) FROM public."StaffAccessEvent")
       <> v_before.history
    OR (SELECT count(*) FROM public."AuditLog")
       <> v_before.audits THEN
    RAISE EXCEPTION 'FAIL: Unauthorized database writes';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public."StaffAssignment"
    WHERE "userId" = 14 AND "profile" = 'CTO' AND "active"
  ) OR NOT EXISTS (
    SELECT 1 FROM public."StaffAssignment"
    WHERE "userId" = 15
      AND "profile" = 'SENIOR_ENGINEER'
      AND "active" = false
  ) THEN
    RAISE EXCEPTION 'FAIL: Assignment state changed';
  END IF;

  RAISE NOTICE 'PASS: No unauthorized assignment changes';
  RAISE NOTICE 'PASS: No assertion consumption or audit/history writes';
END;
$verify$;

ROLLBACK;
