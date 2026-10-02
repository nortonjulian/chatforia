-- Preserve configured forwarding for eligible existing accounts.
-- New accounts must explicitly opt in; downgrades are enforced at delivery time.
ALTER TABLE "User" ADD COLUMN "voicemailEmailForwardingEnabled" BOOLEAN NOT NULL DEFAULT false;
UPDATE "User"
SET "voicemailEmailForwardingEnabled" = true
WHERE "plan"::text IN ('PLUS', 'PREMIUM', 'WIRELESS')
  AND btrim(COALESCE("voicemailForwardEmail", '')) <> '';
