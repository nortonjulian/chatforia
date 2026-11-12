-- Existing rows stay NULL and retain the legacy server-local evaluation until a client saves a zone.
ALTER TABLE "User" ADD COLUMN "forwardQuietHoursTimeZone" VARCHAR(64);

-- The restricted runtime role has column-level UPDATE grants on User. New
-- columns do not inherit those grants from migration 157.
GRANT UPDATE ("forwardQuietHoursTimeZone") ON public."User" TO chatforia_dev;
