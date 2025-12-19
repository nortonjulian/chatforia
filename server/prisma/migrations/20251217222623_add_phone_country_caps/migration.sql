-- AlterTable
ALTER TABLE "PhoneNumber" ADD COLUMN     "capabilities" JSONB,
ADD COLUMN     "isoCountry" VARCHAR(2);

-- CreateIndex
CREATE INDEX "PhoneNumber_isoCountry_status_idx" ON "PhoneNumber"("isoCountry", "status");
