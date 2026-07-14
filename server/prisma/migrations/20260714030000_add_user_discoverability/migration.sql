DO $$
BEGIN
  CREATE TYPE "UserDiscoverability" AS ENUM (
    'EVERYONE',
    'CONTACTS_ONLY',
    'NO_ONE'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$$;

ALTER TABLE "User"
ADD COLUMN IF NOT EXISTS "discoverability"
"UserDiscoverability" NOT NULL DEFAULT 'EVERYONE';
