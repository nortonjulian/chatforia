-- Preserve existing Ria preferences while standardizing the column name.
-- Fresh migration-based databases may have foriaRemember.
-- Existing production databases may already have riaRemember.

DO $migration$
DECLARE
  has_old BOOLEAN;
  has_new BOOLEAN;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'User'
      AND column_name = 'foriaRemember'
  ) INTO has_old;

  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'User'
      AND column_name = 'riaRemember'
  ) INTO has_new;

  IF has_old AND NOT has_new THEN
    ALTER TABLE public."User"
      RENAME COLUMN "foriaRemember" TO "riaRemember";

  ELSIF has_old AND has_new THEN
    RAISE EXCEPTION
      'Both Ria preference columns exist; manual review required';

  ELSIF NOT has_old AND NOT has_new THEN
    RAISE EXCEPTION
      'Neither Ria preference column exists; manual review required';
  END IF;
END
$migration$;
