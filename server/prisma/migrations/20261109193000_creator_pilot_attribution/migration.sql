-- Additive only. No existing account is attributed retroactively.
ALTER TABLE "User"
  ADD COLUMN "creatorReferralCode" VARCHAR(40),
  ADD COLUMN "creatorReferralSource" VARCHAR(32),
  ADD COLUMN "creatorReferredAt" TIMESTAMP(3);
