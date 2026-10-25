-- An old allowAIBot=true was a schema default, not affirmative consent.
-- Existing participant rows remain unconsented until they explicitly opt in.
ALTER TABLE "Participant" ADD COLUMN "riaGroupConsentedAt" TIMESTAMP(3);
