-- AlterTable
ALTER TABLE "PhoneNumber" ADD COLUMN     "forSale" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE INDEX "PhoneNumber_isoCountry_areaCode_status_forSale_idx" ON "PhoneNumber"("isoCountry", "areaCode", "status", "forSale");

-- CreateIndex
CREATE INDEX "PhoneNumber_provider_isoCountry_areaCode_status_forSale_idx" ON "PhoneNumber"("provider", "isoCountry", "areaCode", "status", "forSale");
