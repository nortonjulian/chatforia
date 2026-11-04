-- Shared rollback-only staff security fixtures.
-- Include AFTER BEGIN and BEFORE the test's fixture assertions.
-- Never run directly against production.

DO $fixture_guard$
BEGIN
  IF current_database() <> 'chatforia_staff_access_test_20261102'
     OR current_user <> 'juliannorton' THEN
    RAISE EXCEPTION 'STOP: Not the expected local QA database and administrator';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public."User"
    WHERE "id" IN (13, 14, 15, 16, 17, 18)
  )
  OR EXISTS (SELECT 1 FROM public."FounderOwnership")
  OR EXISTS (SELECT 1 FROM public."StaffAssignment") THEN
    RAISE EXCEPTION 'STOP: QA fixture identities or privileged records already exist';
  END IF;
END;
$fixture_guard$;

INSERT INTO public."User"
  ("id", "username", "passwordHash", "tokenVersion")
VALUES
  (13, 'qa_stage2_founder_13', 'qa-unusable-password', 0);

INSERT INTO public."User"
  ("id", "username", "passwordHash",
   "emailVerifiedAt", "twoFactorEnabled",
   "twoFactorEnrolledAt", "totpSecretEnc", "tokenVersion")
VALUES
  (14, 'qa_stage2_cto_14', 'qa-unusable-password',
   now(), true, now(), 'qa-placeholder', 0),
  (15, 'qa_stage2_revoked_15', 'qa-unusable-password',
   now(), true, now(), 'qa-placeholder', 0),
  (16, 'qa_stage2_support_16', 'qa-unusable-password',
   now(), true, now(), 'qa-placeholder', 5),
  (17, 'qa_stage2_access_admin_17', 'qa-unusable-password',
   now(), true, now(), 'qa-placeholder', 0),
  (18, 'qa_stage2_support_18', 'qa-unusable-password',
   now(), true, now(), 'qa-placeholder', 2);

INSERT INTO public."FounderOwnership"
  ("id", "userId", "verificationRef")
VALUES
  (1, 13, 'rollback-only-stage2-fixture');

INSERT INTO public."StaffAssignment"
  ("userId", "profile", "active", "grantedById", "updatedAt")
VALUES
  (14, 'CTO', true, 13, now()),
  (16, 'SUPPORT', true, 17, now()),
  (17, 'ACCESS_ADMIN', true, 13, now()),
  (18, 'SUPPORT', true, 17, now());

INSERT INTO public."StaffAssignment"
  ("userId", "profile", "active", "grantedById",
   "revokedById", "revokedAt", "updatedAt")
VALUES
  (15, 'SENIOR_ENGINEER', false, 14, 14, now(), now());
