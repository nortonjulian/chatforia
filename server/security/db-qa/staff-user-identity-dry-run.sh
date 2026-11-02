#!/bin/zsh
# Inspection-only: creates functions/triggers inside a rolled-back transaction.
set -o pipefail
cd "${0:A:h:h:h:h}" || exit 1
DB='chatforia_staff_access_test_20261102'
FILE='server/prisma/migrations/20261102090000_protect_staff_user_identity/migration.sql'
if [[ "$(git branch --show-current)" != 'feature/staff-access-rbac-20261102' || ! -s "$FILE" || -z "${DATABASE_URL:-}" ]]; then
  echo 'STOP: Expected branch, DATABASE_URL, or migration missing.'; exit 1
fi
TARGET=$(node -e 'try { const u=new URL(process.env.DATABASE_URL); console.log(u.hostname + ":" + (u.port||"5432") + u.pathname + ":" + (u.searchParams.get("schema")||"public")); } catch { console.log("INVALID") }')
if [[ "$TARGET" != "127.0.0.1:5432/$DB:public" ]]; then
  echo 'STOP: Refusing non-local or non-QA database.'; exit 1
fi
if ! psql -h 127.0.0.1 -p 5432 -U "$(whoami)" -d "$DB" -X -At -v ON_ERROR_STOP=1 -c "SELECT count(*) FROM pg_trigger WHERE tgname IN ('protect_staff_user_identity_update','protect_staff_user_identity_delete')" | grep -qx '0'; then
  echo 'STOP: Protection triggers already exist, or database check failed.'; exit 1
fi
{
  printf 'BEGIN;\n'
  cat "$FILE"
  cat <<'SQL'
DO $identity_qa$
DECLARE
  v_founder integer;
  v_before integer;
  v_rows integer;
BEGIN
  -- Refuse collisions with existing users or staff.
  IF EXISTS (
    SELECT 1 FROM public."User"
    WHERE "id" IN (9000013, 9000018, 9000019)
  ) OR EXISTS (
    SELECT 1 FROM public."StaffAssignment"
    WHERE "userId" IN (9000018, 9000019)
  ) THEN
    RAISE EXCEPTION 'STOP: Reserved QA identities already exist';
  END IF;

  -- All fixtures exist only inside the outer transaction.
  INSERT INTO public."User" ("id", "username", "passwordHash")
  VALUES
    (9000013, 'qa_founder_9000013', 'qa-unusable-password'),
    (9000018, 'qa_active_9000018', 'qa-unusable-password'),
    (9000019, 'qa_revoked_9000019', 'qa-unusable-password');

  SELECT "userId" INTO v_founder
  FROM public."FounderOwnership"
  WHERE "id" = 1;

  IF v_founder IS NULL THEN
    INSERT INTO public."FounderOwnership"
      ("id", "userId", "verificationRef")
    VALUES (1, 9000013, 'rollback-only-identity-qa');
    v_founder := 9000013;
  END IF;

  INSERT INTO public."StaffAssignment"
    ("userId", "profile", "active", "grantedById", "updatedAt")
  VALUES
    (9000018, 'SENIOR_ENGINEER', true, v_founder, now()),
    (9000019, 'SUPPORT', false, v_founder, now());

  -- 1. Active staff credentials cannot change.
  BEGIN
    UPDATE public."User"
    SET "passwordHash" = 'unauthorized'
    WHERE "id" = 9000018;

    RAISE EXCEPTION 'FAIL: Staff credential change allowed';
  EXCEPTION WHEN SQLSTATE '42501' THEN
    RAISE NOTICE 'PASS: Staff credential change blocked';
  END;

  -- 2. Founder global role cannot change.
  BEGIN
    UPDATE public."User"
    SET "role" = CASE
      WHEN "role" = 'ADMIN' THEN 'USER'
      ELSE 'ADMIN'
    END
    WHERE "id" = v_founder;

    RAISE EXCEPTION 'FAIL: Founder role change allowed';
  EXCEPTION WHEN SQLSTATE '42501' THEN
    RAISE NOTICE 'PASS: Founder role change blocked';
  END;

  -- 3. Staff accounts cannot be deleted.
  BEGIN
    DELETE FROM public."User"
    WHERE "id" = 9000018;

    RAISE EXCEPTION 'FAIL: Staff deletion allowed';
  EXCEPTION WHEN SQLSTATE '42501' THEN
    RAISE NOTICE 'PASS: Staff deletion blocked';
  END;

  -- 4. Legitimate token-version increments remain possible.
  SELECT "tokenVersion" INTO STRICT v_before
  FROM public."User" WHERE "id" = 9000018;

  UPDATE public."User"
  SET "tokenVersion" = "tokenVersion" + 1
  WHERE "id" = 9000018;

  GET DIAGNOSTICS v_rows = ROW_COUNT;

  IF v_rows <> 1 OR (
    SELECT "tokenVersion" FROM public."User"
    WHERE "id" = 9000018
  ) <> v_before + 1 THEN
    RAISE EXCEPTION 'FAIL: Session-version increment failed';
  END IF;

  RAISE NOTICE 'PASS: Legitimate session-version increment supported';

  -- 5. Staff primary-key changes are rejected.
  BEGIN
    UPDATE public."User"
    SET "id" = 9000118
    WHERE "id" = 9000018;

    RAISE EXCEPTION 'FAIL: Staff account ID change allowed';
  EXCEPTION WHEN SQLSTATE '42501' THEN
    RAISE NOTICE 'PASS: Staff account ID change blocked';
  END;

  -- 6. Revoked staff retain credential protection.
  BEGIN
    UPDATE public."User"
    SET "passwordHash" = 'unauthorized'
    WHERE "id" = 9000019;

    RAISE EXCEPTION 'FAIL: Revoked staff credential change allowed';
  EXCEPTION WHEN SQLSTATE '42501' THEN
    RAISE NOTICE 'PASS: Revoked staff credential change blocked';
  END;
END;
$identity_qa$;

ROLLBACK;
SQL
} | psql -h 127.0.0.1 -p 5432 -U "$(whoami)" -d "$DB" -X -v ON_ERROR_STOP=1 -P pager=off
RESULT=$?
if [[ "$RESULT" -ne 0 ]]; then echo 'STOP: Dry run failed.'; exit 1; fi
COUNT=$(psql -h 127.0.0.1 -p 5432 -U "$(whoami)" -d "$DB" -X -At -v ON_ERROR_STOP=1 -c "SELECT count(*) FROM pg_trigger WHERE tgname IN ('protect_staff_user_identity_update','protect_staff_user_identity_delete')") || exit 1
if [[ "$COUNT" != 0 ]]; then echo 'STOP: Triggers unexpectedly persisted.'; exit 1; fi
echo 'PASS: Rollback-only migration test. Nothing was installed.'
