-- Rename the legacy Teal-specific database column while preserving
-- all existing eSIM profile identifier data.
ALTER TABLE "MobileDataPackPurchase"
RENAME COLUMN "tealProfileId" TO "esimProfileId";

-- Store the provider-specific package/purchase identifier separately
-- from the eSIM profile identifier.
ALTER TABLE "MobileDataPackPurchase"
ADD COLUMN "providerPurchaseId" TEXT;
