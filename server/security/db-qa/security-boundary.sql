\set ON_ERROR_STOP on
BEGIN;

-- Self-contained QA fixtures; discarded by the final ROLLBACK.
DO $fixture$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public."User"
    WHERE "id" IN (16, 17)
  ) THEN
    RAISE EXCEPTION 'STOP: QA fixture IDs already occupied';
  END IF;
END;
$fixture$;

INSERT INTO public."User"
  ("id", "username", "passwordHash", "tokenVersion")
VALUES
  (16, 'qa_boundary_user_16', 'qa-unusable-password', 5),
  (17, 'qa_boundary_user_17', 'qa-unusable-password', 0);

SET LOCAL ROLE chatforia_dev;

DO $qa$
DECLARE
  v_version INTEGER;
BEGIN
  -- Staff assignments cannot be directly modified.
  BEGIN
    UPDATE public."StaffAssignment"
    SET "active" = false
    WHERE "userId" = 16;
    RAISE EXCEPTION 'FAIL: Staff UPDATE allowed';
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE 'PASS: Direct staff UPDATE denied';
  END;

  -- Staff history cannot be forged.
  BEGIN
    INSERT INTO public."StaffAccessEvent" (
      "actorUserId", "subjectUserId", "action"
    ) VALUES (17, 16, 'QA_FORGERY');
    RAISE EXCEPTION 'FAIL: Staff history INSERT allowed';
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE 'PASS: Staff history INSERT denied';
  END;

  -- Previously revoked sessions cannot be revalidated
  -- by decreasing the session version.
  SELECT "tokenVersion" INTO STRICT v_version
  FROM public."User" WHERE "id" = 16;

  IF v_version < 1 THEN
    RAISE EXCEPTION 'STOP: Invalid QA fixture';
  END IF;

  BEGIN
    UPDATE public."User"
    SET "tokenVersion" = v_version - 1
    WHERE "id" = 16;
    RAISE EXCEPTION 'FAIL: Session version decrease allowed';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE 'PASS: Session version decrease denied';
  END;

  -- Forged staff audit actions are rejected.
  BEGIN
    INSERT INTO public."AuditLog" (
      "actorId", "action", "resource", "status"
    ) VALUES (
      17, 'STAFF_ACCESS_REVOKED', 'user', 200
    );
    RAISE EXCEPTION 'FAIL: Staff audit forgery allowed';
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE 'PASS: Staff audit forgery denied';
  END;

  -- Protected resources cannot be impersonated.
  BEGIN
    INSERT INTO public."AuditLog" (
      "actorId", "action", "resource", "status"
    ) VALUES (
      17, 'QA_ACTION', 'staff_assignment', 200
    );
    RAISE EXCEPTION 'FAIL: Staff resource forgery allowed';
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE 'PASS: Staff resource forgery denied';
  END;

  -- Ordinary application audit logging still works.
  INSERT INTO public."AuditLog" (
    "actorId", "action", "resource", "status"
  ) VALUES (
    17, 'QA_ORDINARY_EVENT', 'user', 200
  );

  RAISE NOTICE 'PASS: Ordinary audit logging preserved';
END;
$qa$;

ROLLBACK;
